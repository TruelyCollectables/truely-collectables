import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

export type InstaCompTeacherReceipt = {
  schemaVersion: "tcos.instacomp.teacher-comp-receipt.v1";
  source: "instacomp";
  scanId: string | null;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  canonicalIdentity: Record<string, unknown>;
  teacherConsensus: {
    configuredTeachers: string[];
    requiredVotes: number;
    trusted: boolean;
    attempts: unknown[];
  };
  acceptedSoldComps: unknown[];
  discoverySoldComps: unknown[];
  discoveryActiveComps: unknown[];
  trustedSuggestedPrice: number | null;
  pricingEligibleSoldCount: number;
  studentMode: true;
  pricingAuthority: false;
  identityTrainingMutationAllowed: false;
  createdAt: string;
};

export type InstaCompTeacherLearningBridgeResult = {
  status: "saved" | "duplicate" | "skipped" | "failed";
  receiptId: number | null;
  trustedMarketTruth: boolean;
  studentTrainingEligible: boolean;
  pricingAuthority: false;
  identityTrainingMutated: false;
  reason: string | null;
};

function localMacBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!configured) return null;
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    return null;
  }
  return configured;
}

function localMacKey() {
  return String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim() || null;
}

export async function pushInstaCompTeacherReceipt(
  receipt: InstaCompTeacherReceipt,
): Promise<InstaCompTeacherLearningBridgeResult> {
  const baseUrl = localMacBaseUrl();
  const key = localMacKey();
  if (!baseUrl || !key) {
    return {
      status: "skipped",
      receiptId: null,
      trustedMarketTruth: false,
      studentTrainingEligible: false,
      pricingAuthority: false,
      identityTrainingMutated: false,
      reason: "The authenticated InstaComp AI Mac learning bridge is not configured.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/training/teacher-comp-receipt`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(receipt),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.ok !== true) {
      return {
        status: "failed",
        receiptId: null,
        trustedMarketTruth: false,
        studentTrainingEligible: false,
        pricingAuthority: false,
        identityTrainingMutated: false,
        reason: sanitizeInstaCompProviderError(
          String(payload.detail || payload.error || `Mac learning bridge HTTP ${response.status}`),
        ),
      };
    }

    const rawId = Number(payload.receipt_id);
    return {
      status: payload.status === "duplicate" ? "duplicate" : "saved",
      receiptId: Number.isInteger(rawId) && rawId > 0 ? rawId : null,
      trustedMarketTruth: payload.trusted_market_truth === true,
      studentTrainingEligible: payload.student_training_eligible === true,
      pricingAuthority: false,
      identityTrainingMutated: false,
      reason: null,
    };
  } catch (error) {
    return {
      status: "failed",
      receiptId: null,
      trustedMarketTruth: false,
      studentTrainingEligible: false,
      pricingAuthority: false,
      identityTrainingMutated: false,
      reason: sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}
