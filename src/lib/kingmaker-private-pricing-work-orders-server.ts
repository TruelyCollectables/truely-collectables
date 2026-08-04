import { createClient } from "@supabase/supabase-js";
import {
  InstaCompJobServerError,
  type InstaCompJobActor,
} from "./instacomp-job-server";

export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES = [
  "queued",
  "in_progress",
  "blocked",
  "completed",
  "dismissed",
] as const;

export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_FILTERS = [
  "untracked",
  ...KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES,
] as const;

export type KingmakerPrivatePricingWorkOrderStatus =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES)[number];
export type KingmakerPrivatePricingWorkOrderFilter =
  (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_FILTERS)[number];

export type KingmakerPrivatePricingWorkOrderListInput = {
  limit?: unknown;
  offset?: unknown;
  status?: unknown;
  search?: unknown;
};

export type KingmakerPrivatePricingWorkOrderSaveInput = {
  attackKey?: unknown;
  status?: unknown;
  priority?: unknown;
  notes?: unknown;
  expectedVersion?: unknown;
};

export type KingmakerPrivatePricingWorkOrder = {
  status: KingmakerPrivatePricingWorkOrderFilter;
  priority: number;
  notes: string;
  version: number;
  updatedAt: string | null;
  startedAt: string | null;
  blockedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
};

export type KingmakerPrivatePricingWorkOrderRow = {
  rank: number;
  attackKey: string;
  targetActive: boolean;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  gapType: "missing_release" | "checklist_pending" | "set_gap" | "identity_gap";
  actionabilityStatus: "actionable" | "parser_review";
  actionabilityReasons: string[];
  recommendedAction: string;
  potentialUnlock: number;
  distinctCardNumbers: number;
  sourceRefreshedAt: string | null;
  workOrder: KingmakerPrivatePricingWorkOrder;
};

export type KingmakerPrivatePricingWorkOrdersReport = {
  generatedAt: string;
  boundary: "private_coverage_work_orders_only";
  filters: {
    status: KingmakerPrivatePricingWorkOrderFilter | null;
    search: string | null;
  };
  summary: {
    totalTargets: number;
    trackedTargets: number;
    untrackedTargets: number;
    queuedTargets: number;
    inProgressTargets: number;
    blockedTargets: number;
    completedTargets: number;
    dismissedTargets: number;
    inactiveTargets: number;
    activePotentialUnlock: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalTargets: number;
    hasMore: boolean;
  };
  rows: KingmakerPrivatePricingWorkOrderRow[];
};

type JsonObject = Record<string, unknown>;
type DatabaseError = { code?: string | null };

function databaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new InstaCompJobServerError(
      "Private pricing work orders are not configured.",
      503,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_NOT_CONFIGURED",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireAdministrator(actor: InstaCompJobActor) {
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "Administrative access is required for private pricing work orders.",
      403,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_ADMIN_REQUIRED",
    );
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      `Private pricing work orders returned an invalid ${label}.`,
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_INVALID_RESPONSE",
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

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
}

function timestamp(value: unknown) {
  return text(value, 60);
}

function filterStatus(value: unknown): KingmakerPrivatePricingWorkOrderFilter | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_FILTERS.includes(
    normalized as KingmakerPrivatePricingWorkOrderFilter,
  )
    ? (normalized as KingmakerPrivatePricingWorkOrderFilter)
    : null;
}

function saveStatus(value: unknown): KingmakerPrivatePricingWorkOrderStatus | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES.includes(
    normalized as KingmakerPrivatePricingWorkOrderStatus,
  )
    ? (normalized as KingmakerPrivatePricingWorkOrderStatus)
    : null;
}

function gapType(value: unknown): KingmakerPrivatePricingWorkOrderRow["gapType"] {
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
    "Private pricing work orders returned an unsupported gap type.",
    500,
    "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_GAP_INVALID",
  );
}

function actionability(
  value: unknown,
): KingmakerPrivatePricingWorkOrderRow["actionabilityStatus"] {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_");
  if (normalized === "actionable" || normalized === "parser_review") {
    return normalized;
  }
  throw new InstaCompJobServerError(
    "Private pricing work orders returned an unsupported quality state.",
    500,
    "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_QUALITY_INVALID",
  );
}

function parseWorkOrder(value: unknown): KingmakerPrivatePricingWorkOrder {
  const workOrder = object(value, "work order");
  const status = filterStatus(workOrder.status);
  if (!status) {
    throw new InstaCompJobServerError(
      "Private pricing work orders returned an unsupported status.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_STATUS_INVALID",
    );
  }
  return {
    status,
    priority: integer(workOrder.priority, 3, 1, 5),
    notes: string(workOrder.notes).slice(0, 2000),
    version: integer(workOrder.version, 0, 0, 1_000_000_000),
    updatedAt: timestamp(workOrder.updatedAt),
    startedAt: timestamp(workOrder.startedAt),
    blockedAt: timestamp(workOrder.blockedAt),
    completedAt: timestamp(workOrder.completedAt),
    dismissedAt: timestamp(workOrder.dismissedAt),
  };
}

function parseReport(value: unknown): KingmakerPrivatePricingWorkOrdersReport {
  const payload = object(value, "payload");
  const boundary = string(payload.boundary);
  if (boundary !== "private_coverage_work_orders_only") {
    throw new InstaCompJobServerError(
      "Private pricing work-order boundary verification failed.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_BOUNDARY_INVALID",
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
      status: filterStatus(filters.status),
      search: text(filters.search, 160),
    },
    summary: {
      totalTargets: finiteNumber(summary.totalTargets),
      trackedTargets: finiteNumber(summary.trackedTargets),
      untrackedTargets: finiteNumber(summary.untrackedTargets),
      queuedTargets: finiteNumber(summary.queuedTargets),
      inProgressTargets: finiteNumber(summary.inProgressTargets),
      blockedTargets: finiteNumber(summary.blockedTargets),
      completedTargets: finiteNumber(summary.completedTargets),
      dismissedTargets: finiteNumber(summary.dismissedTargets),
      inactiveTargets: finiteNumber(summary.inactiveTargets),
      activePotentialUnlock: finiteNumber(summary.activePotentialUnlock),
    },
    pagination: {
      limit: finiteNumber(pagination.limit, 100),
      offset: finiteNumber(pagination.offset),
      returned: finiteNumber(pagination.returned),
      totalTargets: finiteNumber(pagination.totalTargets),
      hasMore: pagination.hasMore === true,
    },
    rows: rows.map((value, index) => {
      const row = object(value, `row ${index + 1}`);
      const attackKey = text(row.attackKey, 80);
      if (!attackKey) {
        throw new InstaCompJobServerError(
          "Private pricing work orders returned a target without a key.",
          500,
          "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_KEY_INVALID",
        );
      }
      return {
        rank: finiteNumber(row.rank, index + 1),
        attackKey,
        targetActive: row.targetActive === true,
        sport: string(row.sport, "Unknown"),
        releaseYear: string(row.releaseYear, "Unknown"),
        manufacturer: string(row.manufacturer, "Unknown"),
        product: string(row.product, "Unknown"),
        setName: string(row.setName, "Base / Unspecified"),
        gapType: gapType(row.gapType),
        actionabilityStatus: actionability(row.actionabilityStatus),
        actionabilityReasons: stringArray(row.actionabilityReasons),
        recommendedAction: string(row.recommendedAction),
        potentialUnlock: finiteNumber(row.potentialUnlock),
        distinctCardNumbers: finiteNumber(row.distinctCardNumbers),
        sourceRefreshedAt: timestamp(row.sourceRefreshedAt),
        workOrder: parseWorkOrder(row.workOrder),
      } satisfies KingmakerPrivatePricingWorkOrderRow;
    }),
  };
}

export async function getKingmakerPrivatePricingWorkOrders(
  actor: InstaCompJobActor,
  input: KingmakerPrivatePricingWorkOrderListInput = {},
) {
  requireAdministrator(actor);
  const limit = integer(input.limit, 100, 1, 250);
  const offset = integer(input.offset, 0, 0, 100000);
  const status = filterStatus(input.status);
  const search = text(input.search, 160);

  const { data, error } = await databaseClient().rpc(
    "tcos_kingmaker_private_pricing_work_orders_report",
    {
      p_limit: limit,
      p_offset: offset,
      p_status: status,
      p_search: search,
    },
  );

  if (error) {
    throw new InstaCompJobServerError(
      "Private pricing work orders could not be loaded.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_QUERY_FAILED",
    );
  }

  return parseReport(data);
}

export async function saveKingmakerPrivatePricingWorkOrder(
  actor: InstaCompJobActor,
  input: KingmakerPrivatePricingWorkOrderSaveInput,
) {
  requireAdministrator(actor);
  const attackKey = text(input.attackKey, 80);
  const status = saveStatus(input.status);
  const priority = integer(input.priority, 3, 1, 5);
  const notes = typeof input.notes === "string"
    ? input.notes.trim().slice(0, 2000)
    : "";
  const expectedVersion = integer(input.expectedVersion, 0, 0, 1_000_000_000);

  if (!attackKey || !status) {
    throw new InstaCompJobServerError(
      "A valid private pricing target and work-order status are required.",
      400,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_INVALID",
    );
  }

  const { data, error } = await databaseClient().rpc(
    "tcos_save_kingmaker_private_pricing_work_order",
    {
      p_attack_key: attackKey,
      p_status: status,
      p_priority: priority,
      p_notes: notes,
      p_expected_version: expectedVersion,
    },
  );

  if (error) {
    const code = (error as DatabaseError).code || "";
    if (code === "40001") {
      throw new InstaCompJobServerError(
        "This work order changed. Reload the queue and try again.",
        409,
        "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STALE",
      );
    }
    if (code === "P0002") {
      throw new InstaCompJobServerError(
        "This coverage target is no longer active. Reload the queue.",
        404,
        "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_TARGET_MISSING",
      );
    }
    throw new InstaCompJobServerError(
      "Private pricing work order could not be saved.",
      500,
      "KINGMAKER_PRIVATE_PRICING_WORK_ORDER_SAVE_FAILED",
    );
  }

  return parseWorkOrder(data);
}
