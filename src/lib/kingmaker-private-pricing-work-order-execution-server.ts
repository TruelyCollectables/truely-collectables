import { createClient } from "@supabase/supabase-js";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";

export const KINGMAKER_EXECUTION_LANES = [
  "unassigned",
  "assigned",
  "overdue",
  "blocked",
  "due_for_review",
  "recently_resolved",
] as const;

export const KINGMAKER_BLOCKED_REASONS = [
  "missing_checklist",
  "missing_pricing_source",
  "identity_conflict",
  "insufficient_evidence",
  "source_access_problem",
  "other",
] as const;

export const KINGMAKER_RESOLUTION_CODES = [
  "coverage_fixed",
  "no_action_needed",
  "invalid_target",
  "more_evidence_required",
  "dismissed_duplicate",
] as const;

type JsonObject = Record<string, unknown>;
type DatabaseError = { code?: string | null };

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new InstaCompJobServerError("Work-order execution controls are not configured.", 503, "KINGMAKER_EXECUTION_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireAdmin(actor: InstaCompJobActor) {
  if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required.", 403, "KINGMAKER_EXECUTION_ADMIN_REQUIRED");
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InstaCompJobServerError(`Execution controls returned an invalid ${label}.`, 500, "KINGMAKER_EXECUTION_INVALID_RESPONSE");
  return value as JsonObject;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function timestamp(value: unknown) { return text(value, 60); }
function finite(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

function allowed<T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  const normalized = text(value, 80)?.toLowerCase().replaceAll("-", "_") || null;
  return normalized && values.includes(normalized as T[number]) ? normalized as T[number] : null;
}

export async function getKingmakerWorkOrderExecution(actor: InstaCompJobActor, input: { limit?: unknown; offset?: unknown; lane?: unknown } = {}) {
  requireAdmin(actor);
  const limit = integer(input.limit, 100, 1, 250);
  const offset = integer(input.offset, 0, 0, 100000);
  const lane = allowed(input.lane, KINGMAKER_EXECUTION_LANES);
  const { data, error } = await client().rpc("tcos_kingmaker_private_pricing_work_order_execution_report", { p_limit: limit, p_offset: offset, p_lane: lane });
  if (error) throw new InstaCompJobServerError("Execution queue could not be loaded.", 500, "KINGMAKER_EXECUTION_QUERY_FAILED");
  const payload = object(data, "payload");
  if (payload.boundary !== "private_coverage_work_order_execution_only") throw new InstaCompJobServerError("Execution boundary verification failed.", 500, "KINGMAKER_EXECUTION_BOUNDARY_INVALID");
  const summary = object(payload.summary, "summary");
  const pagination = object(payload.pagination, "pagination");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    generatedAt: text(payload.generatedAt, 60) || new Date().toISOString(),
    boundary: payload.boundary,
    summary: {
      totalTargets: finite(summary.totalTargets), unassignedTargets: finite(summary.unassignedTargets), assignedTargets: finite(summary.assignedTargets), overdueTargets: finite(summary.overdueTargets), blockedTargets: finite(summary.blockedTargets), dueForReviewTargets: finite(summary.dueForReviewTargets), recentlyResolvedTargets: finite(summary.recentlyResolvedTargets),
    },
    pagination: { limit: finite(pagination.limit, limit), offset: finite(pagination.offset), returned: finite(pagination.returned), totalTargets: finite(pagination.totalTargets), hasMore: pagination.hasMore === true },
    rows: rows.map((value, index) => {
      const row = object(value, `row ${index + 1}`);
      const attackKey = text(row.attackKey, 80);
      if (!attackKey) throw new InstaCompJobServerError("Execution queue returned a target without a key.", 500, "KINGMAKER_EXECUTION_KEY_INVALID");
      return {
        rank: finite(row.rank, index + 1), attackKey, lane: allowed(row.lane, KINGMAKER_EXECUTION_LANES) || "unassigned", status: text(row.status, 40) || "queued", priority: integer(row.priority, 3, 1, 5), version: integer(row.version, 0, 0, 1_000_000_000), assignee: text(row.assignee, 120), claimedAt: timestamp(row.claimedAt), releasedAt: timestamp(row.releasedAt), dueAt: timestamp(row.dueAt), nextReviewAt: timestamp(row.nextReviewAt), blockedReason: allowed(row.blockedReason, KINGMAKER_BLOCKED_REASONS), resolutionCode: allowed(row.resolutionCode, KINGMAKER_RESOLUTION_CODES), updatedAt: timestamp(row.updatedAt), sport: text(row.sport, 80) || "Unknown", releaseYear: text(row.releaseYear, 40) || "Unknown", manufacturer: text(row.manufacturer, 120) || "Unknown", product: text(row.product, 180) || "Unknown", setName: text(row.setName, 180) || "Base / Unspecified", gapType: text(row.gapType, 40) || "identity_gap", actionabilityStatus: text(row.actionabilityStatus, 40) || "actionable", potentialUnlock: finite(row.potentialUnlock),
      };
    }),
  };
}

export async function updateKingmakerWorkOrderExecution(actor: InstaCompJobActor, input: Record<string, unknown>) {
  requireAdmin(actor);
  const attackKey = text(input.attackKey, 80);
  const operation = allowed(input.operation, ["claim", "release", "update", "resolve"] as const);
  const expectedVersion = integer(input.expectedVersion, -1, -1, 1_000_000_000);
  if (!attackKey || !operation || expectedVersion < 0) throw new InstaCompJobServerError("A valid target, operation, and version are required.", 400, "KINGMAKER_EXECUTION_INVALID");
  const assignee = text(input.assignee, 120);
  const priority = input.priority === null || input.priority === undefined || input.priority === "" ? null : integer(input.priority, 3, 1, 5);
  const dueAt = timestamp(input.dueAt);
  const blockedReason = allowed(input.blockedReason, KINGMAKER_BLOCKED_REASONS);
  const resolutionCode = allowed(input.resolutionCode, KINGMAKER_RESOLUTION_CODES);
  const { data, error } = await client().rpc("tcos_update_kingmaker_private_pricing_work_order_execution", {
    p_attack_key: attackKey, p_expected_version: expectedVersion, p_operation: operation, p_assignee: assignee, p_priority: priority, p_due_at: dueAt, p_blocked_reason: blockedReason, p_resolution_code: resolutionCode,
  });
  if (error) {
    const code = (error as DatabaseError).code || "";
    if (code === "40001") throw new InstaCompJobServerError("This work order changed. Reload and try again.", 409, "KINGMAKER_EXECUTION_STALE");
    if (code === "P0002") throw new InstaCompJobServerError("This work order is unavailable. Reload the queue.", 404, "KINGMAKER_EXECUTION_NOT_FOUND");
    if (code === "22023" || code === "23514") throw new InstaCompJobServerError(error.message || "Execution update is invalid.", 400, "KINGMAKER_EXECUTION_INPUT_INVALID");
    throw new InstaCompJobServerError("Execution controls could not be saved.", 500, "KINGMAKER_EXECUTION_SAVE_FAILED");
  }
  return object(data, "saved work order");
}
