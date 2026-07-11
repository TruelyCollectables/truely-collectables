import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidAdminSessionValue } from "./admin-session";
import { MAX_INSTACOMP_JOB_CARDS } from "./instacomp-job-state";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export const INSTACOMP_JOB_TABLE = "instacomp_scan_jobs";
export const INSTACOMP_JOB_ITEM_TABLE = "instacomp_scan_items";
export const INSTACOMP_JOB_IMAGE_BUCKET =
  process.env.INSTACOMP_JOB_IMAGE_BUCKET || "instacomp-job-images";
export { MAX_INSTACOMP_JOB_CARDS };
export const INSTACOMP_JOB_MAX_ITEMS = MAX_INSTACOMP_JOB_CARDS;
export const INSTACOMP_JOB_ITEM_CHUNK_LIMIT = 25;
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

export function requireInstaCompJobSupabase(): SupabaseClient {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    throw new InstaCompJobServerError(
      "InstaComp job storage is not configured.",
      503,
      "INSTACOMP_SUPABASE_URL_MISSING",
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new InstaCompJobServerError(
      "InstaComp persistent jobs require the Supabase service-role key.",
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

  const adminSession = cookieValue(request, "admin_auth");

  if (await isValidAdminSessionValue(adminSession)) {
    return {
      type: "admin",
      storeId,
      sellerAccountId: null,
    };
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
      "InstaComp job was not found.",
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
      "InstaComp persistent jobs are unavailable until the scan-job migration is applied.",
      503,
      "INSTACOMP_JOB_MIGRATION_REQUIRED",
    );
  }

  const databaseError = (error || {}) as DatabaseError;

  throw new InstaCompJobServerError(
    databaseError.message || "InstaComp job database operation failed.",
    500,
    "INSTACOMP_JOB_DATABASE_ERROR",
    process.env.NODE_ENV === "development" ? databaseError : undefined,
  );
}

export function throwInstaCompRpcError(error: DatabaseError | unknown): never {
  if (isInstaCompMigrationMissing(error)) {
    throwInstaCompDatabaseError(error);
  }

  const databaseError = (error || {}) as DatabaseError;
  const code = String(databaseError.code || "").toUpperCase();
  const message = databaseError.message || "InstaComp queue action failed.";

  if (code === "P0002") {
    throw new InstaCompJobServerError(
      message,
      404,
      "INSTACOMP_QUEUE_ROW_NOT_FOUND",
    );
  }

  if (code === "22023" || code === "22P02") {
    throw new InstaCompJobServerError(
      message,
      400,
      "INSTACOMP_QUEUE_INVALID_INPUT",
    );
  }

  if (code === "55000" || code === "23514") {
    throw new InstaCompJobServerError(
      message,
      409,
      "INSTACOMP_QUEUE_STATE_CONFLICT",
    );
  }

  throwInstaCompDatabaseError(error);
}

export function isUuid(value: unknown): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export function requireUuid(value: unknown, label: string) {
  const text = String(value || "").trim();

  if (!isUuid(text)) {
    throw new InstaCompJobServerError(
      `${label} must be a valid UUID.`,
      400,
      "INSTACOMP_INVALID_UUID",
    );
  }

  return text;
}

export function cleanInstaCompText(
  value: unknown,
  maxLength: number,
  options?: { required?: boolean; label?: string },
) {
  const text = String(value ?? "").trim();

  if (!text && options?.required) {
    throw new InstaCompJobServerError(
      `${options.label || "Value"} is required.`,
      400,
      "INSTACOMP_REQUIRED_VALUE",
    );
  }

  return text ? text.slice(0, maxLength) : null;
}

export function boundedInstaCompInteger(params: {
  value: unknown;
  label: string;
  minimum: number;
  maximum: number;
  fallback?: number;
}) {
  const raw =
    params.value === null || params.value === undefined || params.value === ""
      ? params.fallback
      : Number(params.value);

  if (
    raw === undefined ||
    !Number.isInteger(raw) ||
    raw < params.minimum ||
    raw > params.maximum
  ) {
    throw new InstaCompJobServerError(
      `${params.label} must be a whole number from ${params.minimum} to ${params.maximum}.`,
      400,
      "INSTACOMP_INVALID_NUMBER",
    );
  }

  return raw;
}

export function isAllowedInstaCompImageType(value: unknown) {
  return ["image/jpeg", "image/png", "image/webp"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

export function instaCompImageExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function buildInstaCompJobImagePath(params: {
  actor: InstaCompJobActor;
  sellerAccountId?: string | null;
  jobId: string;
  itemId: string;
  side: "front" | "back";
  mimeType: string;
}) {
  const owner =
    params.sellerAccountId ||
    (params.actor.type === "seller" ? params.actor.sellerAccountId : "admin");

  return [
    "jobs",
    params.actor.storeId,
    owner,
    params.jobId,
    params.itemId,
    `${params.side}.${instaCompImageExtension(params.mimeType)}`,
  ].join("/");
}

export async function createInstaCompSignedUpload(params: {
  supabase: SupabaseClient;
  path: string;
}) {
  const { data, error } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .createSignedUploadUrl(params.path, { upsert: false });

  if (error || !data?.token) {
    const message = error?.message || "Could not authorize an image upload.";
    const missingBucket = /bucket.*not found|not found.*bucket/i.test(message);

    throw new InstaCompJobServerError(
      missingBucket
        ? "InstaComp image storage is unavailable until the private bucket migration is applied."
        : message,
      missingBucket ? 503 : 500,
      missingBucket
        ? "INSTACOMP_JOB_STORAGE_REQUIRED"
        : "INSTACOMP_JOB_UPLOAD_SIGNING_FAILED",
    );
  }

  return {
    path: params.path,
    token: data.token,
  };
}

export async function createInstaCompSignedDownload(
  supabase: SupabaseClient,
  path: unknown,
) {
  const storagePath = String(path || "").trim();

  if (!storagePath) return null;

  const { data, error } = await supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .createSignedUrl(storagePath, INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return {
      path: storagePath,
      downloadUrl: null,
      error: error?.message || "Could not authorize image recovery.",
    };
  }

  return {
    path: storagePath,
    downloadUrl: data.signedUrl,
    expiresIn: INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS,
  };
}

export async function addInstaCompRecoveryUrls(
  supabase: SupabaseClient,
  items: Array<Record<string, any>>,
) {
  const paths = Array.from(
    new Set(
      items
        .flatMap((item) => [item.front_storage_path, item.back_storage_path])
        .map((path) => String(path || "").trim())
        .filter(Boolean),
    ),
  );
  const signedByPath = new Map<
    string,
    { path: string; downloadUrl: string | null; expiresIn: number; error?: string }
  >();

  for (let index = 0; index < paths.length; index += 100) {
    const chunk = paths.slice(index, index + 100);
    const { data, error } = await supabase.storage
      .from(INSTACOMP_JOB_IMAGE_BUCKET)
      .createSignedUrls(chunk, INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS);

    if (error || !data) {
      chunk.forEach((path) =>
        signedByPath.set(path, {
          path,
          downloadUrl: null,
          expiresIn: INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS,
          error: error?.message || "Could not authorize image recovery.",
        }),
      );
      continue;
    }

    data.forEach((entry) => {
      const path = String(entry.path || "");

      if (!path) return;

      signedByPath.set(path, {
        path,
        downloadUrl: entry.signedUrl || null,
        expiresIn: INSTACOMP_JOB_DOWNLOAD_TTL_SECONDS,
        ...(entry.error ? { error: entry.error } : {}),
      });
    });
  }

  const recoveryEntry = (path: unknown) => {
    const storagePath = String(path || "").trim();
    return storagePath ? signedByPath.get(storagePath) || null : null;
  };

  return items.map((item) => ({
    ...item,
    recovery: {
      front: recoveryEntry(item.front_storage_path),
      back: recoveryEntry(item.back_storage_path),
    },
  }));
}

export async function readInstaCompJson(request: Request) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Body must be a JSON object.");
    }

    return body as Record<string, any>;
  } catch (error) {
    if (error instanceof InstaCompJobServerError) throw error;

    throw new InstaCompJobServerError(
      "Request body must be valid JSON.",
      400,
      "INSTACOMP_INVALID_JSON",
    );
  }
}

export async function refreshInstaCompJobCounts(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { error } = await supabase.rpc("tcos_refresh_instacomp_scan_job_counts", {
    p_job_id: jobId,
  });

  if (error) throwInstaCompDatabaseError(error);
}

export function instaCompJobErrorResponse(error: unknown) {
  if (error instanceof InstaCompJobServerError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : "InstaComp job failed.";

  return Response.json(
    {
      error: message,
      code: "INSTACOMP_JOB_INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
