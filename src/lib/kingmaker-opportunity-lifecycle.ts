import { createHash } from "node:crypto";

export const KINGMAKER_LIFECYCLE_STAGES = [
  "detected", "verified", "recommended", "offer_made", "purchased", "received", "listed", "sold", "learned",
] as const;
export type KingmakerLifecycleStage = (typeof KINGMAKER_LIFECYCLE_STAGES)[number];

export type KingmakerLifecycleEvent = {
  opportunityKey: string;
  stage: KingmakerLifecycleStage;
  occurredAt: string;
  actor: "system" | "owner" | "marketplace" | "purchase_ledger";
  amount?: number | null;
  metadata?: Record<string, unknown>;
};

export function validateKingmakerLifecycle(events: KingmakerLifecycleEvent[]) {
  const errors: string[] = [];
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  let previousIndex = -1;
  const seen = new Set<KingmakerLifecycleStage>();
  for (const event of ordered) {
    const timestamp = Date.parse(event.occurredAt);
    if (!Number.isFinite(timestamp)) errors.push("invalid_timestamp");
    const index = KINGMAKER_LIFECYCLE_STAGES.indexOf(event.stage);
    if (index < previousIndex) errors.push("stage_regression");
    if (seen.has(event.stage)) errors.push(`duplicate_stage:${event.stage}`);
    if (event.stage === "offer_made" && !(typeof event.amount === "number" && event.amount > 0)) errors.push("offer_amount_required");
    if (["purchased", "sold"].includes(event.stage) && !(typeof event.amount === "number" && event.amount > 0)) errors.push(`${event.stage}_amount_required`);
    previousIndex = Math.max(previousIndex, index);
    seen.add(event.stage);
  }
  if (seen.has("sold") && !seen.has("purchased")) errors.push("sold_without_purchase");
  if (seen.has("learned") && !seen.has("sold")) errors.push("learned_without_sale");
  const currentStage = ordered.at(-1)?.stage ?? null;
  const canonical = ordered.map((event) => ({ ...event, metadata: event.metadata ?? {} }));
  return {
    valid: errors.length === 0,
    currentStage,
    errors: [...new Set(errors)],
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
