import { createHash } from "node:crypto";
import type {
  KingmakerExecutiveAction,
  KingmakerLiveDecision,
  KingmakerLiveObservation,
  KingmakerLiveSource,
} from "./kingmaker-phase-5-live-execution";
import { evaluateKingmakerLiveObservation } from "./kingmaker-phase-5-live-execution";

export type KingmakerAdapterResult = {
  source: KingmakerLiveSource;
  startedAt: string;
  completedAt: string;
  scanned: number;
  observations: KingmakerLiveObservation[];
  rejected: number;
  retries: number;
  rateLimited: boolean;
  error?: string;
};

export type KingmakerAdapter = {
  source: KingmakerLiveSource;
  run: () => Promise<KingmakerAdapterResult>;
};

export type KingmakerRuntimeEventType =
  | "adapter_started"
  | "adapter_completed"
  | "adapter_failed"
  | "observation_received"
  | "decision_created"
  | "decision_changed"
  | "source_degraded"
  | "source_offline";

export type KingmakerRuntimeEvent = {
  type: KingmakerRuntimeEventType;
  occurredAt: string;
  source?: KingmakerLiveSource;
  entityKey?: string;
  decisionFingerprint?: string;
  metadata: Record<string, string | number | boolean | null>;
  fingerprint: string;
};

export type KingmakerOpportunityAge = "fresh" | "hot" | "cooling" | "stale" | "dead";

export type KingmakerExplainedDecision = KingmakerLiveDecision & {
  age: KingmakerOpportunityAge;
  ageHours: number;
  executionPriority: number;
  explanation: {
    verdict: string;
    economicCase: string;
    confidenceCase: string;
    riskCase: string;
    nextAction: string;
  };
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function finiteDate(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function classifyKingmakerOpportunityAge(observedAt: string, now: string): { age: KingmakerOpportunityAge; ageHours: number } {
  const observedMs = finiteDate(observedAt);
  const nowMs = finiteDate(now);
  if (observedMs === null || nowMs === null || observedMs > nowMs) return { age: "dead", ageHours: Number.POSITIVE_INFINITY };
  const ageHours = Number(((nowMs - observedMs) / 3_600_000).toFixed(2));
  if (ageHours <= 1) return { age: "hot", ageHours };
  if (ageHours <= 12) return { age: "fresh", ageHours };
  if (ageHours <= 48) return { age: "cooling", ageHours };
  if (ageHours <= 168) return { age: "stale", ageHours };
  return { age: "dead", ageHours };
}

function actionPriority(action: KingmakerExecutiveAction) {
  return ({ buy_now: 100, make_offer: 80, watch: 50, research: 30, reject: 0 } satisfies Record<KingmakerExecutiveAction, number>)[action];
}

export function explainKingmakerDecision(observation: KingmakerLiveObservation, now: string): KingmakerExplainedDecision {
  const decision = evaluateKingmakerLiveObservation(observation);
  const ageInfo = classifyKingmakerOpportunityAge(observation.observedAt, now);
  const agePenalty = ({ hot: 0, fresh: 5, cooling: 20, stale: 45, dead: 100 } satisfies Record<KingmakerOpportunityAge, number>)[ageInfo.age];
  const executionPriority = Math.max(0, Number((
    actionPriority(decision.action)
    + Math.min(40, decision.expectedRoiPercent / 2)
    + decision.confidence * 20
    - decision.riskScore / 3
    - agePenalty
  ).toFixed(2)));

  const nextAction = ageInfo.age === "dead"
    ? "Do not execute; refresh the listing and evidence."
    : decision.action === "buy_now"
      ? "Prepare owner authorization for the exact delivered cost."
      : decision.action === "make_offer"
        ? `Stage an offer at $${decision.recommendedOffer?.toFixed(2) ?? "0.00"} and never exceed $${decision.walkAwayPrice?.toFixed(2) ?? "0.00"}.`
        : decision.action === "watch"
          ? "Keep monitoring for a better entry or stronger evidence."
          : decision.action === "research"
            ? "Resolve the evidence or momentum weakness before risking capital."
            : "Reject and retain the reasons for future learning.";

  return {
    ...decision,
    age: ageInfo.age,
    ageHours: ageInfo.ageHours,
    executionPriority,
    explanation: {
      verdict: `${decision.action.replaceAll("_", " ")} with priority ${executionPriority}.`,
      economicCase: `Delivered cost $${decision.deliveredCost.toFixed(2)}, expected profit $${decision.expectedProfit.toFixed(2)}, expected ROI ${decision.expectedRoiPercent.toFixed(2)}%.`,
      confidenceCase: `Confidence ${(decision.confidence * 100).toFixed(0)}%; opportunity age ${ageInfo.age} at ${ageInfo.ageHours} hour(s).`,
      riskCase: `Risk score ${decision.riskScore.toFixed(0)} with ${decision.reasons.join(", ") || "no additional warnings"}.`,
      nextAction,
    },
  };
}

export async function runKingmakerAdapterFleet(input: {
  adapters: KingmakerAdapter[];
  now: string;
  timeoutMs?: number;
}): Promise<{
  results: KingmakerAdapterResult[];
  decisions: KingmakerExplainedDecision[];
  events: KingmakerRuntimeEvent[];
  fingerprint: string;
}> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const events: KingmakerRuntimeEvent[] = [];
  const addEvent = (event: Omit<KingmakerRuntimeEvent, "fingerprint">) => events.push({ ...event, fingerprint: hash(event) });

  const results = await Promise.all(input.adapters.map(async (adapter): Promise<KingmakerAdapterResult> => {
    addEvent({ type: "adapter_started", occurredAt: input.now, source: adapter.source, metadata: {} });
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("adapter_timeout")), timeoutMs));
      const result = await Promise.race([adapter.run(), timeout]);
      addEvent({
        type: "adapter_completed",
        occurredAt: result.completedAt,
        source: result.source,
        metadata: { scanned: result.scanned, accepted: result.observations.length, rejected: result.rejected, retries: result.retries, rateLimited: result.rateLimited },
      });
      if (result.rateLimited || result.rejected > result.observations.length) {
        addEvent({ type: "source_degraded", occurredAt: result.completedAt, source: result.source, metadata: { rateLimited: result.rateLimited, rejected: result.rejected } });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "adapter_failed";
      addEvent({ type: "adapter_failed", occurredAt: input.now, source: adapter.source, metadata: { error: message } });
      addEvent({ type: "source_offline", occurredAt: input.now, source: adapter.source, metadata: { error: message } });
      return {
        source: adapter.source,
        startedAt: input.now,
        completedAt: input.now,
        scanned: 0,
        observations: [],
        rejected: 0,
        retries: 0,
        rateLimited: false,
        error: message,
      };
    }
  }));

  const decisions = results.flatMap((result) => result.observations.map((observation) => {
    addEvent({ type: "observation_received", occurredAt: observation.observedAt, source: observation.source, entityKey: observation.entityKey, metadata: { sourceRecordId: observation.sourceRecordId } });
    const decision = explainKingmakerDecision(observation, input.now);
    addEvent({ type: "decision_created", occurredAt: input.now, source: observation.source, entityKey: observation.entityKey, decisionFingerprint: decision.fingerprint, metadata: { action: decision.action, priority: decision.executionPriority } });
    return decision;
  })).sort((left, right) => right.executionPriority - left.executionPriority || right.expectedProfit - left.expectedProfit);

  const canonical = { results, decisions, events };
  return { ...canonical, fingerprint: hash(canonical) };
}
