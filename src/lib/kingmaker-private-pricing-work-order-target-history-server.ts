import { createClient } from "@supabase/supabase-js";
import {
  InstaCompJobServerError,
  type InstaCompJobActor,
} from "./instacomp-job-server";
import { KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS } from "./kingmaker-private-pricing-work-order-activity-server";

type JsonObject = Record<string, unknown>;
type ActivityAction =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS)[number];

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new InstaCompJobServerError(
      "KINGMAKER work-order history is not configured.",
      503,
      "KINGMAKER_TARGET_HISTORY_NOT_CONFIGURED",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireAdministrator(actor: InstaCompJobActor) {
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "Administrative access is required for KINGMAKER work-order history.",
      403,
      "KINGMAKER_TARGET_HISTORY_ADMIN_REQUIRED",
    );
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      `KINGMAKER work-order history returned an invalid ${label}.`,
      500,
      "KINGMAKER_TARGET_HISTORY_INVALID_RESPONSE",
    );
  }
  return value as JsonObject;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function action(value: unknown): ActivityAction | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS.includes(
    normalized as ActivityAction,
  )
    ? (normalized as ActivityAction)
    : null;
}

export async function getKingmakerWorkOrderTargetHistory(
  actorValue: InstaCompJobActor,
  input: { attackKey?: unknown; limit?: unknown; offset?: unknown },
) {
  requireAdministrator(actorValue);
  const attackKey = text(input.attackKey, 80);
  const limit = integer(input.limit, 50, 1, 100);
  const offset = integer(input.offset, 0, 0, 100000);
  if (!attackKey) {
    throw new InstaCompJobServerError(
      "A work-order target is required.",
      400,
      "KINGMAKER_TARGET_HISTORY_TARGET_REQUIRED",
    );
  }

  const { data, error } = await client().rpc(
    "tcos_kingmaker_private_pricing_work_order_target_history_report",
    {
      p_attack_key: attackKey,
      p_limit: limit,
      p_offset: offset,
    },
  );
  if (error) {
    const code = error.code || "";
    if (code === "P0002") {
      throw new InstaCompJobServerError(
        "This work order is unavailable. Reload the queue.",
        404,
        "KINGMAKER_TARGET_HISTORY_NOT_FOUND",
      );
    }
    if (code === "22023") {
      throw new InstaCompJobServerError(
        error.message || "The work-order history request is invalid.",
        400,
        "KINGMAKER_TARGET_HISTORY_INPUT_INVALID",
      );
    }
    throw new InstaCompJobServerError(
      "KINGMAKER work-order history could not be loaded.",
      500,
      "KINGMAKER_TARGET_HISTORY_QUERY_FAILED",
    );
  }

  const payload = object(data, "payload");
  if (payload.boundary !== "private_coverage_work_order_target_history_only") {
    throw new InstaCompJobServerError(
      "KINGMAKER work-order history boundary verification failed.",
      500,
      "KINGMAKER_TARGET_HISTORY_BOUNDARY_INVALID",
    );
  }
  const target = object(payload.target, "target");
  const summary = object(payload.summary, "summary");
  const pagination = object(payload.pagination, "pagination");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  return {
    generatedAt: text(payload.generatedAt, 60) || new Date().toISOString(),
    boundary: payload.boundary,
    target: {
      status: text(target.status, 40) || "queued",
      priority: integer(target.priority, 3, 1, 5),
      version: integer(target.version, 0, 0, 1_000_000_000),
      targetActive: target.targetActive === true,
      sport: text(target.sport, 80) || "Unknown",
      releaseYear: text(target.releaseYear, 40) || "Unknown",
      manufacturer: text(target.manufacturer, 120) || "Unknown",
      product: text(target.product, 180) || "Unknown",
      setName: text(target.setName, 180) || "Base / Unspecified",
      gapType: text(target.gapType, 40) || "identity_gap",
      actionabilityStatus:
        text(target.actionabilityStatus, 40) || "actionable",
    },
    summary: {
      totalEvents: number(summary.totalEvents),
      adminEvents: number(summary.adminEvents),
      systemEvents: number(summary.systemEvents),
      noteChangeEvents: number(summary.noteChangeEvents),
      createdEvents: number(summary.createdEvents),
      updatedEvents: number(summary.updatedEvents),
      autoResolvedEvents: number(summary.autoResolvedEvents),
      autoReopenedEvents: number(summary.autoReopenedEvents),
      reviewScheduledEvents: number(summary.reviewScheduledEvents),
      reviewClearedEvents: number(summary.reviewClearedEvents),
      claimedEvents: number(summary.claimedEvents),
      releasedEvents: number(summary.releasedEvents),
      executionUpdatedEvents: number(summary.executionUpdatedEvents),
      resolutionRecordedEvents: number(summary.resolutionRecordedEvents),
    },
    pagination: {
      limit: number(pagination.limit, limit),
      offset: number(pagination.offset, offset),
      returned: number(pagination.returned),
      totalEvents: number(pagination.totalEvents),
      hasMore: pagination.hasMore === true,
    },
    rows: rows.map((raw, index) => {
      const row = object(raw, `event ${index + 1}`);
      const parsedAction = action(row.action);
      const actorType = text(row.actorType, 40);
      const createdAt = text(row.createdAt, 60);
      if (
        !parsedAction ||
        (actorType !== "admin" && actorType !== "system") ||
        !createdAt
      ) {
        throw new InstaCompJobServerError(
          "KINGMAKER work-order history returned an incomplete event.",
          500,
          "KINGMAKER_TARGET_HISTORY_EVENT_INVALID",
        );
      }
      return {
        rank: number(row.rank, offset + index + 1),
        action: parsedAction,
        status: text(row.status, 40) || "queued",
        priority: integer(row.priority, 3, 1, 5),
        version: integer(row.version, 0, 0, 1_000_000_000),
        notesChanged: row.notesChanged === true,
        actorType,
        createdAt,
      };
    }),
  };
}
