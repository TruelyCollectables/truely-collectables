import { createClient } from "@supabase/supabase-js";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";

export const REVIEW_STATES = ["overdue", "due_soon", "scheduled", "unscheduled"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

type JsonObject = Record<string, unknown>;
type DbError = { code?: string | null };

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new InstaCompJobServerError("Review scheduling is not configured.", 503, "KINGMAKER_REVIEW_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function admin(actor: InstaCompJobActor) {
  if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required.", 403, "KINGMAKER_REVIEW_ADMIN_REQUIRED");
}
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InstaCompJobServerError(`Invalid ${label}.`, 500, "KINGMAKER_REVIEW_INVALID_RESPONSE");
  return value as JsonObject;
}
function num(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function text(value: unknown, max = 160) { return typeof value === "string" ? value.trim().slice(0, max) || null : null; }
function state(value: unknown): ReviewState | null {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_") || null;
  return REVIEW_STATES.includes(normalized as ReviewState) ? normalized as ReviewState : null;
}

export async function getKingmakerWorkOrderReviews(actor: InstaCompJobActor, input: Record<string, unknown> = {}) {
  admin(actor);
  const limit = Math.max(1, Math.min(250, Math.trunc(num(input.limit, 100))));
  const offset = Math.max(0, Math.min(100000, Math.trunc(num(input.offset, 0))));
  const reviewState = state(input.reviewState);
  const { data, error } = await client().rpc("tcos_kingmaker_private_pricing_work_order_review_report", { p_limit: limit, p_offset: offset, p_review_state: reviewState });
  if (error) throw new InstaCompJobServerError("Review planner could not be loaded.", 500, "KINGMAKER_REVIEW_QUERY_FAILED");
  const payload = object(data, "review report");
  if (payload.boundary !== "private_coverage_work_order_reviews_only") throw new InstaCompJobServerError("Review boundary verification failed.", 500, "KINGMAKER_REVIEW_BOUNDARY_INVALID");
  return payload;
}

export async function scheduleKingmakerWorkOrderReview(actor: InstaCompJobActor, input: Record<string, unknown>) {
  admin(actor);
  const attackKey = text(input.attackKey, 80);
  const expectedVersion = Math.max(0, Math.trunc(num(input.expectedVersion, 0)));
  const nextReviewAt = input.nextReviewAt === null || input.nextReviewAt === "" ? null : text(input.nextReviewAt, 60);
  if (!attackKey) throw new InstaCompJobServerError("A coverage target is required.", 400, "KINGMAKER_REVIEW_TARGET_REQUIRED");
  if (nextReviewAt && Number.isNaN(Date.parse(nextReviewAt))) throw new InstaCompJobServerError("A valid review date is required.", 400, "KINGMAKER_REVIEW_DATE_INVALID");
  const { data, error } = await client().rpc("tcos_schedule_kingmaker_private_pricing_work_order_review", { p_attack_key: attackKey, p_next_review_at: nextReviewAt, p_expected_version: expectedVersion });
  if (error) {
    const code = (error as DbError).code || "";
    if (code === "40001") throw new InstaCompJobServerError("This work order changed. Reload and try again.", 409, "KINGMAKER_REVIEW_STALE");
    if (code === "P0002") throw new InstaCompJobServerError("This work order is no longer eligible for review scheduling.", 404, "KINGMAKER_REVIEW_MISSING");
    throw new InstaCompJobServerError("Review date could not be saved.", 500, "KINGMAKER_REVIEW_SAVE_FAILED");
  }
  return object(data, "saved review");
}
