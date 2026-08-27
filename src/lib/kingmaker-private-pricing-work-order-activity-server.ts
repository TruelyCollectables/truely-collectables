import { createClient } from "@supabase/supabase-js";
import {
  InstaCompJobServerError,
  type InstaCompJobActor,
} from "./instacomp-job-server";

export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS = [
  "created",
  "updated",
  "auto_resolved",
  "auto_reopened",
  "review_scheduled",
  "review_cleared",
  "claimed",
  "released",
  "execution_updated",
  "resolution_recorded",
] as const;

export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS = [
  "admin",
  "system",
] as const;

type Action =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS)[number];
type Actor =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS)[number];
type JsonObject = Record<string, unknown>;

function databaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new InstaCompJobServerError(
      "Private pricing work-order activity is not configured.",
      503,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_NOT_CONFIGURED",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireAdministrator(actor: InstaCompJobActor) {
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "Administrative access is required for private pricing work-order activity.",
      403,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ADMIN_REQUIRED",
    );
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      `Private pricing work-order activity returned an invalid ${label}.`,
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_INVALID_RESPONSE",
    );
  }
  return value as JsonObject;
}

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function action(value: unknown): Action | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS.includes(
    normalized as Action,
  )
    ? (normalized as Action)
    : null;
}

function actor(value: unknown): Actor | null {
  const normalized = text(value, 40)?.toLowerCase() || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS.includes(
    normalized as Actor,
  )
    ? (normalized as Actor)
    : null;
}

export async function getKingmakerPrivatePricingWorkOrderActivity(
  actorValue: InstaCompJobActor,
  input: Record<string, unknown> = {},
) {
  requireAdministrator(actorValue);
  const limit = Math.max(
    1,
    Math.min(250, Math.trunc(number(input.limit, 100))),
  );
  const offset = Math.max(
    0,
    Math.min(100000, Math.trunc(number(input.offset, 0))),
  );
  const selectedAction = action(input.action);
  const selectedActor = actor(input.actorType);
  const { data, error } = await databaseClient().rpc(
    "tcos_kingmaker_private_pricing_work_order_activity_report",
    {
      p_limit: limit,
      p_offset: offset,
      p_action: selectedAction,
      p_actor_type: selectedActor,
    },
  );
  if (error) {
    throw new InstaCompJobServerError(
      "Private pricing work-order activity could not be loaded.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_QUERY_FAILED",
    );
  }
  const payload = object(data, "payload");
  if (payload.boundary !== "private_coverage_work_order_activity_only") {
    throw new InstaCompJobServerError(
      "Private pricing work-order activity boundary verification failed.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_BOUNDARY_INVALID",
    );
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const parsedRows = rows.map((raw, index) => {
    const row = object(raw, `row ${index + 1}`);
    const parsedAction = action(row.action);
    const parsedActor = actor(row.actorType);
    const createdAt = text(row.createdAt, 60);
    if (!parsedAction || !parsedActor || !createdAt) {
      throw new InstaCompJobServerError(
        "Private pricing work-order activity returned an incomplete event.",
        500,
        "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_EVENT_INVALID",
      );
    }
    return {
      rank: number(row.rank, index + 1),
      action: parsedAction,
      status: text(row.status, 40),
      priority: number(row.priority, 3),
      version: number(row.version, 1),
      notesChanged: row.notesChanged === true,
      actorType: parsedActor,
      createdAt,
      targetActive: row.targetActive === true,
      sport: text(row.sport) || "Unknown",
      releaseYear: text(row.releaseYear) || "Unknown",
      manufacturer: text(row.manufacturer) || "Unknown",
      product: text(row.product) || "Unknown",
      setName: text(row.setName) || "Base / Unspecified",
      gapType: text(row.gapType, 40),
      actionabilityStatus: text(row.actionabilityStatus, 40),
    };
  });
  return { ...payload, rows: parsedRows };
}
