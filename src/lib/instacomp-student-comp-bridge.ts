import type { InstaCompAiResult } from "./instacomp";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

export type InstaCompStudentCompHypothesis = {
  status: "ready" | "skipped" | "failed";
  studentMode: true;
  learnMode: true;
  pricingAuthority: false;
  marketTruth: false;
  model: string | null;
  trainingMemoryExamples: number;
  predictedMedian: number | null;
  predictedLow: number | null;
  predictedHigh: number | null;
  confidence: number;
  rationale: string;
  uncertainty: string[];
  error: string | null;
};

function localMacBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!configured || !/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    return null;
  }
  return configured;
}

function localMacKey() {
  return String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim() || null;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

function confidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function skipped(reason: string): InstaCompStudentCompHypothesis {
  return {
    status: "skipped",
    studentMode: true,
    learnMode: true,
    pricingAuthority: false,
    marketTruth: false,
    model: null,
    trainingMemoryExamples: 0,
    predictedMedian: null,
    predictedLow: null,
    predictedHigh: null,
    confidence: 0,
    rationale: "",
    uncertainty: [],
    error: reason,
  };
}

export async function requestInstaCompStudentCompHypothesis(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
}): Promise<InstaCompStudentCompHypothesis> {
  const baseUrl = localMacBaseUrl();
  const key = localMacKey();
  if (!baseUrl || !key) {
    return skipped("The authenticated InstaComp AI Mac learning bridge is not configured.");
  }

  try {
    const response = await fetch(`${baseUrl}/v1/training/student-comp-hypothesis`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        exactTitle: params.exactTitle,
        canonicalIdentity: {
          player: params.ai.player,
          year: params.ai.year,
          brand: params.ai.brand,
          setName: params.ai.setName,
          cardNumber: params.ai.cardNumber,
          parallel: params.ai.parallel,
          serialNumber: params.ai.serialNumber,
          gradingCompany: params.ai.gradingCompany,
          gradeValue: params.ai.gradeValue,
          isRookie: params.ai.isRookie,
          isAuto: params.ai.isAuto,
          isRelic: params.ai.isRelic,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || payload.ok !== true) {
      return {
        ...skipped(""),
        status: "failed",
        error: sanitizeInstaCompProviderError(
          String(payload.detail || payload.error || `Mac student hypothesis HTTP ${response.status}`),
        ),
      };
    }
    const hypothesis = payload.hypothesis && typeof payload.hypothesis === "object"
      ? payload.hypothesis
      : {};
    return {
      status: "ready",
      studentMode: true,
      learnMode: true,
      pricingAuthority: false,
      marketTruth: false,
      model: String(payload.model || "").trim() || null,
      trainingMemoryExamples: Math.max(0, Number(payload.training_memory_examples || 0) || 0),
      predictedMedian: numberOrNull(hypothesis.predictedMedian),
      predictedLow: numberOrNull(hypothesis.predictedLow),
      predictedHigh: numberOrNull(hypothesis.predictedHigh),
      confidence: confidence(hypothesis.confidence),
      rationale: String(hypothesis.rationale || "").trim().slice(0, 1800),
      uncertainty: Array.isArray(hypothesis.uncertainty)
        ? hypothesis.uncertainty.map((value: unknown) => String(value || "").trim()).filter(Boolean).slice(0, 12)
        : [],
      error: null,
    };
  } catch (error) {
    return {
      ...skipped(""),
      status: "failed",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}
