import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "./admin-session";
import { MAX_INSTACOMP_JOB_CARDS } from "./instacomp-job-state";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export const INSTACOMP_JOB_TABLE = "instacomp_scan_jobs";
export const INSTACOMP_JOB_ITEM_TABLE = "instacomp_scan_items";
export const INSTACOMP_JOB_IMAGE_BUCKET =
  process.env.INSTACOMP_JOB_IMAGE_BUCKET || "instacomp-job-images";
export { MAX_INSTACOMP_JOB_CARDS };
export const INSTACOMP_JOB_MAX_ITEMS = MAX_INSTACOMP_JOB_CARDS;
export const INSTACOMP_JOB_ITEM_CHUNK_LIMIT = 50;
export const INSTACOMP_JOB_MAX_IMAGE_BYTES = 3_000_000;
export const INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS = 60 * 60;
export const INSTACOMP_JOB_STATUSES = new Set([
  "uploading",
  "queued",
  "processing",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelling",
  "cancelled",
]);
export const INSTACOMP_JOB_ITEM_STATUSES = new Set([
  "awaiting_upload",
  "queued",
  "processing",
  "retry_wait",
  "completed",
  "review_required",
  "failed",
  "cancelled",
]);

export type InstaCompJobActor =
  | {
      type: "seller";
      storeId: string;
      sellerAccountId: string;
    }
  | {
      type: "admin";
      storeId: string;
      sellerAccountId: null;
    };

type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export class InstaCompJobServerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status = 400,
    code = "INSTACOMP_JOB_ERROR",
    details?: unknown,
  ) {
    super(message);
    this.name = "InstaCompJobServerError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return undefined;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  return scheme.toLowerCase() === "bearer" && token?.trim()
    ? token.trim()
    : null;
}

function constantTimeSecretMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function isValidInstaCompServiceRequest(
  request: Request,
  expectedToken = process.env.INSTACOMP_SERVICE_TOKEN,
) {
  const expected = String(expectedToken || "").trim();
  const provided = String(
    request.headers.get("x-tcos-instacomp-service-token") || "",
  ).trim();

  return Boolean(
    expected && provided && constantTimeSecretMatch(provided, expected),
  );
}

export function requireInstaCompJobSupabase(): SupabaseClient {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    throw new InstaCompJobServerError(
      "InstaComp™ job storage is not configured.",
      503,
      "INSTACOMP_SUPABASE_URL_MISSING",
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new InstaCompJobServerError(
      "InstaComp™ persistent jobs require the Supabase service-role key.",
      503,
      "INSTACOMP_SERVICE_ROLE_MISSING",
    );
  }

  return createSupabaseServerClient({ admin: true });
}

export async function requireInstaCompJobActor(
  request: Request,
): Promise<InstaCompJobActor> {
  // Fail closed before authentication. These routes must never silently fall
  // back to the anon key when they read or mutate the private job queue.
  const supabase = requireInstaCompJobSupabase();

  const storeId = getActiveStoreId();

  // Internal Profit Hunter / Market Intel workers authenticate with a dedicated
  // service token. It is intentionally separate from seller JWTs and admin
  // cookies so no reusable human session is stored in a background connector.
  if (isValidInstaCompServiceRequest(request)) {
    return {
      type: "admin",
      storeId,
      sellerAccountId: null,
    };
  }

  const token = bearerToken(request);
  let validAccountId: string | null = null;

  if (token) {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);

    if (!authError && authData.user) {
      const accountId = authData.user.id;
      const [{ data: profile }, { data: membership }] = await Promise.all([
        supabase
          .from("account_profiles")
          .select("id,account_status")
          .eq("id", accountId)
          .maybeSingle(),
        supabase
          .from("account_store_memberships")
          .select("id")
          .eq("account_id", accountId)
          .eq("store_id", storeId)
          .eq("role", "seller")
          .eq("status", "active")
          .maybeSingle(),
      ]);

      if (profile?.account_status === "active" && membership) {
        validAccountId = accountId;
      }
    }
  }

  if (validAccountId) {
    return {
      type: "seller",
      storeId,
      sellerAccountId: validAccountId,
    };
  }

  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    const adminSession = cookieValue(request, cookieName);

    if (await isValidAdminSessionValue(adminSession)) {
      return {
        type: "admin",
        storeId,
        sellerAccountId: null,
      };
    }
  }

  throw new InstaCompJobServerError(
    "Sign in as a seller or TCOS administrator.",
    401,
    "INSTACOMP_JOB_UNAUTHORIZED",
  );
}

export function applyInstaCompJobActorScope<T>(
  query: T,
  actor: InstaCompJobActor,
): T {
  let scoped = (query as any).eq("store_id", actor.storeId);

  if (actor.type === "seller") {
    scoped = scoped.eq("seller_account_id", actor.sellerAccountId);
  }

  return scoped as T;
}

export async function getAccessibleInstaCompJob(params: {
  supabase: SupabaseClient;
  actor: InstaCompJobActor;
  jobId: string;
  select?: string;
}) {
  let query = params.supabase
    .from(INSTACOMP_JOB_TABLE)
    .select(params.select || "*")
    .eq("id", params.jobId);

  query = applyInstaCompJobActorScope(query, params.actor);

  const { data, error } = await query.maybeSingle();

  if (error) throwInstaCompDatabaseError(error);

  if (!data) {
    throw new InstaCompJobServerError(
      "InstaComp™ job was not found.",
      404,
      "INSTACOMP_JOB_NOT_FOUND",
    );
  }

  return data as Record<string, any>;
}

export function isInstaCompMigrationMissing(error: DatabaseError | unknown) {
  const databaseError = (error || {}) as DatabaseError;
  const code = String(databaseError.code || "").toUpperCase();
  const message = [
    databaseError.message,
    databaseError.details,
    databaseError.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const namesQueueTable =
    message.includes("instacomp_scan_jobs") ||
    message.includes("instacomp_scan_items");
  const saysMissing =
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("not found");

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    (namesQueueTable && saysMissing) ||
    message.includes("schema cache")
  );
}

export function throwInstaCompDatabaseError(error: DatabaseError | unknown): never {
  if (isInstaCompMigrationMissing(error)) {
    throw new InstaCompJobServerError(
      "InstaComp™ persistent jobs are unavailable until the scan-job migration is applied.",
      503,
      "INSTACOMP_JOB_MIGRATION_REQUIRED",
    );
  }

  const databaseError = (error || {}) as DatabaseError;

  throw new InstaCompJobServerError(
    databaseError.message || "InstaComp™ job database operation failed.",
    500,
    "INSTACOMP_JOB_DATABASE_ERROR",
    databaseError,
  );
}

export function instaCompJobErrorResponse(error: unknown) {
  const serverError =
    error instanceof InstaCompJobServerError
      ? error
      : new InstaCompJobServerError(
          error instanceof Error
            ? error.message
            : "InstaComp™ request failed.",
          500,
          "INSTACOMP_JOB_UNEXPECTED",
        );

  return Response.json(
    {
      ok: false,
      error: serverError.message,
      code: serverError.code,
      details: serverError.details,
    },
    {
      status: serverError.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
