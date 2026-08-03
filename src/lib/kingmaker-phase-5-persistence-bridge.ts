import { createHash } from "node:crypto";
import type { KingmakerCommandCenterDecision, KingmakerOwnerActionRequest } from "./kingmaker-phase-5-command-center";
import type { KingmakerAdapterRunResult, KingmakerRuntimeEvent } from "./kingmaker-phase-5-operations-runtime";

export type KingmakerPersistenceOperation = {
  table: "tcos_kingmaker_live_cycles" | "tcos_kingmaker_live_decisions" | "tcos_kingmaker_source_adapter_runs" | "tcos_kingmaker_owner_actions";
  conflictTarget: string;
  mode: "insert_ignore" | "upsert";
  row: Record<string, unknown>;
  fingerprint: string;
};

export type KingmakerPersistencePlan = {
  cycleFingerprint: string;
  operations: KingmakerPersistenceOperation[];
  eventCount: number;
  decisionCount: number;
  adapterRunCount: number;
  ownerActionCount: number;
  fingerprint: string;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function operation(input: Omit<KingmakerPersistenceOperation, "fingerprint">): KingmakerPersistenceOperation {
  return { ...input, fingerprint: hash(input) };
}

export function buildKingmakerPersistencePlan(input: {
  generatedAt: string;
  cycleFingerprint: string;
  snapshot: Record<string, unknown>;
  decisions: KingmakerCommandCenterDecision[];
  adapterRuns: KingmakerAdapterRunResult[];
  events: KingmakerRuntimeEvent[];
  ownerActions?: KingmakerOwnerActionRequest[];
}): KingmakerPersistencePlan {
  if (!input.cycleFingerprint.trim()) throw new Error("missing_cycle_fingerprint");
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("invalid_generated_at");

  const operations: KingmakerPersistenceOperation[] = [];
  operations.push(operation({
    table: "tcos_kingmaker_live_cycles",
    conflictTarget: "cycle_fingerprint",
    mode: "insert_ignore",
    row: {
      generated_at: input.generatedAt,
      cycle_fingerprint: input.cycleFingerprint,
      snapshot: input.snapshot,
      event_count: input.events.length,
      decision_count: input.decisions.length,
      adapter_run_count: input.adapterRuns.length,
    },
  }));

  for (const decision of input.decisions) {
    operations.push(operation({
      table: "tcos_kingmaker_live_decisions",
      conflictTarget: "decision_fingerprint",
      mode: "upsert",
      row: {
        cycle_fingerprint: input.cycleFingerprint,
        decision_fingerprint: decision.fingerprint,
        entity_key: decision.entityKey,
        source: decision.source,
        source_record_id: decision.sourceRecordId,
        action: decision.action,
        delivered_cost: decision.deliveredCost,
        expected_profit: decision.expectedProfit,
        expected_roi_percent: decision.expectedRoiPercent,
        recommended_offer: decision.recommendedOffer,
        walk_away_price: decision.walkAwayPrice,
        confidence: decision.confidence,
        risk_score: decision.riskScore,
        execution_priority: decision.executionPriority,
        observed_at: decision.observedAt,
        lifecycle_status: decision.lifecycleStatus,
        authorization_status: decision.authorizationStatus,
        payload: decision,
      },
    }));
  }

  for (const run of input.adapterRuns) {
    const runFingerprint = hash({ cycle: input.cycleFingerprint, run });
    operations.push(operation({
      table: "tcos_kingmaker_source_adapter_runs",
      conflictTarget: "run_fingerprint",
      mode: "insert_ignore",
      row: {
        cycle_fingerprint: input.cycleFingerprint,
        run_fingerprint: runFingerprint,
        source: run.source,
        started_at: run.startedAt,
        completed_at: run.completedAt,
        scanned: run.scanned,
        accepted: run.observations.length,
        rejected: run.rejected,
        retries: run.retries,
        rate_limited: run.rateLimited,
        status: run.status,
        error: run.error,
        payload: run,
      },
    }));
  }

  for (const action of input.ownerActions ?? []) {
    if (!action.idempotencyKey.trim()) throw new Error("missing_owner_action_idempotency_key");
    operations.push(operation({
      table: "tcos_kingmaker_owner_actions",
      conflictTarget: "idempotency_key",
      mode: "insert_ignore",
      row: {
        cycle_fingerprint: input.cycleFingerprint,
        decision_fingerprint: action.decisionFingerprint,
        idempotency_key: action.idempotencyKey.trim(),
        owner_id: action.ownerId.trim(),
        action: action.action,
        amount: action.amount ?? null,
        note: action.note?.trim() || null,
        requested_at: action.requestedAt,
        payload: action,
      },
    }));
  }

  const canonical = {
    cycleFingerprint: input.cycleFingerprint,
    operationFingerprints: operations.map((entry) => entry.fingerprint),
    eventFingerprints: input.events.map((entry) => entry.fingerprint),
  };

  return {
    cycleFingerprint: input.cycleFingerprint,
    operations,
    eventCount: input.events.length,
    decisionCount: input.decisions.length,
    adapterRunCount: input.adapterRuns.length,
    ownerActionCount: input.ownerActions?.length ?? 0,
    fingerprint: hash(canonical),
  };
}

export type KingmakerEbayBrowseItem = {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  price?: { value?: string; currency?: string };
  shippingOptions?: Array<{ shippingCost?: { value?: string } }>;
  seller?: { username?: string; feedbackPercentage?: string };
  itemCreationDate?: string;
};

function finite(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeKingmakerEbayBrowseItem(input: {
  item: KingmakerEbayBrowseItem;
  entityKey: string;
  marketValue: number;
  confidence: number;
  riskScore: number;
  momentumScore: number;
}) {
  const errors: string[] = [];
  const itemId = input.item.itemId?.trim() || "";
  const askingPrice = finite(input.item.price?.value);
  const shipping = finite(input.item.shippingOptions?.[0]?.shippingCost?.value) ?? 0;
  const feedback = finite(input.item.seller?.feedbackPercentage);
  const sellerReliability = feedback === null ? 50 : Math.max(0, Math.min(100, feedback));
  if (!itemId) errors.push("missing_item_id");
  if (!input.entityKey.trim()) errors.push("missing_entity_key");
  if (askingPrice === null || askingPrice <= 0) errors.push("invalid_asking_price");
  if (input.item.price?.currency && input.item.price.currency !== "USD") errors.push("unsupported_currency");
  if (!Number.isFinite(Date.parse(input.item.itemCreationDate ?? ""))) errors.push("invalid_observed_at");
  if (!input.item.itemWebUrl?.startsWith("https://www.ebay.com/")) errors.push("unsafe_ebay_url");

  if (errors.length) return { accepted: false as const, errors, observation: null };

  return {
    accepted: true as const,
    errors,
    observation: {
      source: "ebay" as const,
      sourceRecordId: itemId,
      entityKey: input.entityKey.trim(),
      observedAt: input.item.itemCreationDate as string,
      askingPrice: Number((askingPrice as number).toFixed(2)),
      shipping: Number(shipping.toFixed(2)),
      fees: 0,
      marketValue: Number(input.marketValue.toFixed(2)),
      confidence: input.confidence,
      sellerReliability,
      riskScore: input.riskScore,
      momentumScore: input.momentumScore,
      sourceUrl: input.item.itemWebUrl,
    },
  };
}
