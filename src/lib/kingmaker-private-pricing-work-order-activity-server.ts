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
] as const;

export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS = [
  "admin",
  "system",
] as const;

export type KingmakerPrivatePricingWorkOrderActivityAction =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS)[number];
export type KingmakerPrivatePricingWorkOrderActivityActor =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS)[number];
export type KingmakerPrivatePricingWorkOrderActivityStatus =
  | "queued"
  | "in_progress"
  | "blocked"
  | "resolved"
  | "completed"
  | "dismissed";

export type KingmakerPrivatePricingWorkOrderActivityListInput = {
  limit?: unknown;
  offset?: unknown;
  action?: unknown;
  actorType?: unknown;
};

export type KingmakerPrivatePricingWorkOrderActivityRow = {
  rank: number;
  action: KingmakerPrivatePricingWorkOrderActivityAction;
  status: KingmakerPrivatePricingWorkOrderActivityStatus;
  priority: number;
  version: number;
  notesChanged: boolean;
  actorType: KingmakerPrivatePricingWorkOrderActivityActor;
  createdAt: string;
  targetActive: boolean;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  gapType: "missing_release" | "checklist_pending" | "set_gap" | "identity_gap";
  actionabilityStatus: "actionable" | "parser_review";
};

export type KingmakerPrivatePricingWorkOrderActivityReport = {
  generatedAt: string;
  boundary: "private_coverage_work_order_activity_only";
  filters: {
    action: KingmakerPrivatePricingWorkOrderActivityAction | null;
    actorType: KingmakerPrivatePricingWorkOrderActivityActor | null;
  };
  summary: {
    totalEvents: number;
    adminEvents: number;
    systemEvents: number;
    noteChangeEvents: number;
    createdEvents: number;
    updatedEvents: number;
    autoResolvedEvents: number;
    autoReopenedEvents: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalEvents: number;
    hasMore: boolean;
  };
  rows: KingmakerPrivatePricingWorkOrderActivityRow[];
};

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

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximum) || null
    : null;
}

function string(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function timestamp(value: unknown) {
  return text(value, 60);
}

function activityAction(
  value: unknown,
): KingmakerPrivatePricingWorkOrderActivityAction | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS.includes(
    normalized as KingmakerPrivatePricingWorkOrderActivityAction,
  )
    ? (normalized as KingmakerPrivatePricingWorkOrderActivityAction)
    : null;
}

function activityActor(
  value: unknown,
): KingmakerPrivatePricingWorkOrderActivityActor | null {
  const normalized = text(value, 40)?.toLowerCase() || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS.includes(
    normalized as KingmakerPrivatePricingWorkOrderActivityActor,
  )
    ? (normalized as KingmakerPrivatePricingWorkOrderActivityActor)
    : null;
}

function activityStatus(value: unknown): KingmakerPrivatePricingWorkOrderActivityStatus {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_");
  if (
    normalized === "queued" ||
    normalized === "in_progress" ||
    normalized === "blocked" ||
    normalized === "resolved" ||
    normalized === "completed" ||
    normalized === "dismissed"
  ) {
    return normalized;
  }

  throw new InstaCompJobServerError(
    "Private pricing work-order activity returned an unsupported status.",
    500,
    "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_STATUS_INVALID",
  );
}

function gapType(value: unknown): KingmakerPrivatePricingWorkOrderActivityRow["gapType"] {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_");
  if (
    normalized === "missing_release" ||
    normalized === "checklist_pending" ||
    normalized === "set_gap" ||
    normalized === "identity_gap"
  ) {
    return normalized;
  }

  throw new InstaCompJobServerError(
    "Private pricing work-order activity returned an unsupported gap type.",
    500,
    "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_GAP_INVALID",
  );
}

function actionability(
  value: unknown,
): KingmakerPrivatePricingWorkOrderActivityRow["actionabilityStatus"] {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_");
  if (normalized === "actionable" || normalized === "parser_review") {
    return normalized;
  }

  throw new InstaCompJobServerError(
    "Private pricing work-order activity returned an unsupported quality state.",
    500,
    "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_QUALITY_INVALID",
  );
}

function parseReport(value: unknown): KingmakerPrivatePricingWorkOrderActivityReport {
  const payload = object(value, "payload");
  const boundary = string(payload.boundary);
  if (boundary !== "private_coverage_work_order_activity_only") {
    throw new InstaCompJobServerError(
      "Private pricing work-order activity boundary verification failed.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_BOUNDARY_INVALID",
    );
  }

  const filters = object(payload.filters, "filters");
  const summary = object(payload.summary, "summary");
  const pagination = object(payload.pagination, "pagination");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  return {
    generatedAt: string(payload.generatedAt, new Date().toISOString()),
    boundary,
    filters: {
      action: activityAction(filters.action),
      actorType: activityActor(filters.actorType),
    },
    summary: {
      totalEvents: finiteNumber(summary.totalEvents),
      adminEvents: finiteNumber(summary.adminEvents),
      systemEvents: finiteNumber(summary.systemEvents),
      noteChangeEvents: finiteNumber(summary.noteChangeEvents),
      createdEvents: finiteNumber(summary.createdEvents),
      updatedEvents: finiteNumber(summary.updatedEvents),
      autoResolvedEvents: finiteNumber(summary.autoResolvedEvents),
      autoReopenedEvents: finiteNumber(summary.autoReopenedEvents),
    },
    pagination: {
      limit: finiteNumber(pagination.limit, 100),
      offset: finiteNumber(pagination.offset),
      returned: finiteNumber(pagination.returned),
      totalEvents: finiteNumber(pagination.totalEvents),
      hasMore: pagination.hasMore === true,
    },
    rows: rows.map((value, index) => {
      const row = object(value, `row ${index + 1}`);
      const action = activityAction(row.action);
      const actorType = activityActor(row.actorType);
      const createdAt = timestamp(row.createdAt);
      if (!action || !actorType || !createdAt) {
        throw new InstaCompJobServerError(
          "Private pricing work-order activity returned an incomplete event.",
          500,
          "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_EVENT_INVALID",
        );
      }

      return {
        rank: finiteNumber(row.rank, index + 1),
        action,
        status: activityStatus(row.status),
        priority: integer(row.priority, 3, 1, 5),
        version: integer(row.version, 1, 1, 1_000_000_000),
        notesChanged: row.notesChanged === true,
        actorType,
        createdAt,
        targetActive: row.targetActive === true,
        sport: string(row.sport, "Unknown"),
        releaseYear: string(row.releaseYear, "Unknown"),
        manufacturer: string(row.manufacturer, "Unknown"),
        product: string(row.product, "Unknown"),
        setName: string(row.setName, "Base / Unspecified"),
        gapType: gapType(row.gapType),
        actionabilityStatus: actionability(row.actionabilityStatus),
      } satisfies KingmakerPrivatePricingWorkOrderActivityRow;
    }),
  };
}

export async function getKingmakerPrivatePricingWorkOrderActivity(
  actor: InstaCompJobActor,
  input: KingmakerPrivatePricingWorkOrderActivityListInput = {},
) {
  requireAdministrator(actor);
  const limit = integer(input.limit, 100, 1, 250);
  const offset = integer(input.offset, 0, 0, 100000);
  const action = activityAction(input.action);
  const actorType = activityActor(input.actorType);

  const { data, error } = await databaseClient().rpc(
    "tcos_kingmaker_private_pricing_work_order_activity_report",
    {
      p_limit: limit,
      p_offset: offset,
      p_action: action,
      p_actor_type: actorType,
    },
  );

  if (error) {
    throw new InstaCompJobServerError(
      "Private pricing work-order activity could not be loaded.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_QUERY_FAILED",
    );
  }

  return parseReport(data);
}
