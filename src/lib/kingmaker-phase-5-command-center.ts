import { createHash } from "node:crypto";
import type { KingmakerExecutiveAction, KingmakerLiveDecision, KingmakerSourceHealth } from "./kingmaker-phase-5-live-execution";

export type KingmakerOwnerQueueAction = "approve" | "reject" | "watch" | "research" | "cancel";

export type KingmakerCommandCenterDecision = KingmakerLiveDecision & {
  sourceRecordId: string;
  sourceUrl: string | null;
  observedAt: string;
  age: "hot" | "fresh" | "cooling" | "stale" | "dead";
  executionPriority: number;
  sellerReliability: number;
  momentumScore: number;
  authorizationStatus: "not_required" | "pending" | "authorized" | "expired" | "cancelled" | "used";
  lifecycleStatus: "proposed" | "authorized" | "executing" | "succeeded" | "failed" | "cancelled" | "expired";
};

export type KingmakerOwnerActionRequest = {
  decisionFingerprint: string;
  action: KingmakerOwnerQueueAction;
  ownerId: string;
  amount?: number | null;
  note?: string | null;
  requestedAt: string;
  idempotencyKey: string;
};

export type KingmakerCommandCenterReadModel = {
  generatedAt: string;
  totals: {
    all: number;
    buyNow: number;
    offers: number;
    watch: number;
    research: number;
    rejected: number;
    authorizationPending: number;
    sourceWarnings: number;
  };
  queues: Record<"buy_now" | "make_offer" | "watch" | "research" | "reject", KingmakerCommandCenterDecision[]>;
  sourceHealth: KingmakerSourceHealth[];
  morningIntelligence: {
    headline: string;
    urgent: KingmakerCommandCenterDecision[];
    unresolvedOwnerActions: KingmakerCommandCenterDecision[];
    warnings: string[];
  };
  api: {
    version: "v1";
    resource: "kingmaker-command-center";
    generatedAt: string;
    etag: string;
  };
  fingerprint: string;
};

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function finiteMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

export function validateKingmakerOwnerAction(input: KingmakerOwnerActionRequest, decision: KingmakerCommandCenterDecision) {
  const errors: string[] = [];
  if (!input.ownerId.trim()) errors.push("missing_owner_id");
  if (!input.idempotencyKey.trim()) errors.push("missing_idempotency_key");
  if (input.decisionFingerprint !== decision.fingerprint) errors.push("decision_fingerprint_mismatch");
  if (!Number.isFinite(Date.parse(input.requestedAt))) errors.push("invalid_requested_at");
  if (decision.age === "dead") errors.push("opportunity_dead");
  if (["succeeded", "failed", "cancelled", "expired"].includes(decision.lifecycleStatus)) errors.push("decision_terminal");

  const amount = finiteMoney(input.amount);
  if (input.action === "approve") {
    if (!(["buy_now", "make_offer"] as KingmakerExecutiveAction[]).includes(decision.action)) errors.push("approval_not_required");
    if (amount === null || amount <= 0) {
      errors.push("invalid_action_amount");
    } else if (decision.action === "buy_now" && amount !== decision.deliveredCost) {
      errors.push("buy_amount_mismatch");
    } else if (decision.action === "make_offer") {
      if (decision.recommendedOffer === null || decision.walkAwayPrice === null) errors.push("offer_economics_missing");
      if (amount !== decision.recommendedOffer) errors.push("offer_amount_mismatch");
      if (decision.walkAwayPrice !== null && amount > decision.walkAwayPrice) errors.push("offer_above_walkaway");
    }
  }

  if (input.action === "cancel" && decision.lifecycleStatus === "executing") errors.push("cannot_cancel_executing_action");

  const canonical = {
    decisionFingerprint: input.decisionFingerprint,
    action: input.action,
    ownerId: input.ownerId.trim(),
    amount,
    note: input.note?.trim() || null,
    requestedAt: input.requestedAt,
    idempotencyKey: input.idempotencyKey.trim(),
    errors,
  };

  return {
    accepted: errors.length === 0,
    errors,
    normalized: canonical,
    fingerprint: stableHash(canonical),
  };
}

export function paginateKingmakerDecisions(input: {
  decisions: KingmakerCommandCenterDecision[];
  action?: KingmakerExecutiveAction;
  source?: string;
  minimumPriority?: number;
  cursor?: string | null;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const filtered = input.decisions
    .filter((decision) => !input.action || decision.action === input.action)
    .filter((decision) => !input.source || decision.source === input.source)
    .filter((decision) => decision.executionPriority >= (input.minimumPriority ?? Number.NEGATIVE_INFINITY))
    .sort((left, right) => right.executionPriority - left.executionPriority || left.fingerprint.localeCompare(right.fingerprint));

  const start = input.cursor ? Math.max(0, filtered.findIndex((decision) => decision.fingerprint === input.cursor) + 1) : 0;
  const items = filtered.slice(start, start + limit);
  const nextCursor = start + limit < filtered.length ? items.at(-1)?.fingerprint ?? null : null;

  return {
    items,
    nextCursor,
    total: filtered.length,
    fingerprint: stableHash({ items: items.map((item) => item.fingerprint), nextCursor, total: filtered.length }),
  };
}

export function buildKingmakerCommandCenterReadModel(input: {
  generatedAt: string;
  decisions: KingmakerCommandCenterDecision[];
  sourceHealth: KingmakerSourceHealth[];
}): KingmakerCommandCenterReadModel {
  const sorted = [...input.decisions].sort((left, right) => right.executionPriority - left.executionPriority || left.fingerprint.localeCompare(right.fingerprint));
  const queues = {
    buy_now: sorted.filter((decision) => decision.action === "buy_now"),
    make_offer: sorted.filter((decision) => decision.action === "make_offer"),
    watch: sorted.filter((decision) => decision.action === "watch"),
    research: sorted.filter((decision) => decision.action === "research"),
    reject: sorted.filter((decision) => decision.action === "reject"),
  };
  const unresolvedOwnerActions = sorted.filter((decision) =>
    (decision.action === "buy_now" || decision.action === "make_offer") &&
    decision.authorizationStatus === "pending" &&
    !["dead", "stale"].includes(decision.age),
  );
  const urgent = sorted.filter((decision) => decision.executionPriority >= 100 && decision.age !== "dead").slice(0, 10);
  const warnings: string[] = [];
  if (input.sourceHealth.some((source) => source.status === "offline")) warnings.push("one_or_more_sources_offline");
  if (input.sourceHealth.some((source) => source.status === "degraded")) warnings.push("one_or_more_sources_degraded");
  if (unresolvedOwnerActions.length) warnings.push("owner_actions_pending");
  if (!queues.buy_now.length && !queues.make_offer.length) warnings.push("no_actionable_opportunities");

  const preliminary = {
    generatedAt: input.generatedAt,
    totals: {
      all: sorted.length,
      buyNow: queues.buy_now.length,
      offers: queues.make_offer.length,
      watch: queues.watch.length,
      research: queues.research.length,
      rejected: queues.reject.length,
      authorizationPending: unresolvedOwnerActions.length,
      sourceWarnings: input.sourceHealth.filter((source) => source.status !== "healthy").length,
    },
    queues,
    sourceHealth: [...input.sourceHealth].sort((left, right) => left.source.localeCompare(right.source)),
    morningIntelligence: {
      headline: urgent.length
        ? `KINGMAKER has ${urgent.length} urgent opportunity${urgent.length === 1 ? "" : "ies"} ready for review.`
        : "KINGMAKER has no urgent deployment recommendations.",
      urgent,
      unresolvedOwnerActions,
      warnings,
    },
  };
  const fingerprint = stableHash(preliminary);

  return {
    ...preliminary,
    api: {
      version: "v1",
      resource: "kingmaker-command-center",
      generatedAt: input.generatedAt,
      etag: fingerprint,
    },
    fingerprint,
  };
}
