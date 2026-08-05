// Production safety fallback: this module is imported before the scan route
// resolves its model constants. Keep the operator-selected primary model, but
// always give the identity reader a broadly available vision-capable fallback.
// This prevents an inaccessible primary/fallback model pair from killing every
// front-and-back card scan.
process.env.INSTACOMP_OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

export type InstaCompAiProviderCandidate<T> = {
  provider: string;
  family: string;
  configured: boolean;
  run: () => Promise<T>;
};

export type InstaCompAiProviderAttempt = {
  provider: string;
  family: string;
  status: "completed" | "not_configured" | "error" | "skipped";
  message: string | null;
};

export const INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS = 5;

export function sanitizeInstaCompProviderFailure(error: unknown) {
  const text = String(error instanceof Error ? error.message : error)
    .toLowerCase();

  if (/abort|cancel/.test(text)) return "cancelled";
  if (/timeout|timed out|deadline/.test(text)) return "timeout";
  if (/quota|rate.?limit|too many requests|\b429\b/.test(text)) {
    return "quota_or_rate_limit";
  }
  if (/unauthori[sz]ed|forbidden|invalid api key|\b401\b|\b403\b/.test(text)) {
    return "authentication_failed";
  }
  if (/model.*not found|does not exist|not.*access|unsupported model/.test(text)) {
    return "model_unavailable";
  }
  if (/unavailable|overloaded|gateway|\b50[0234]\b/.test(text)) {
    return "provider_unavailable";
  }
  if (/json|schema|no scan content|invalid response/.test(text)) {
    return "invalid_provider_response";
  }
  return "provider_error";
}

export async function runInstaCompPrimaryAiFailover<T>(
  candidates: InstaCompAiProviderCandidate<T>[],
  options: { maximumAttempts?: number } = {},
) {
  const attempts: InstaCompAiProviderAttempt[] = [];
  const attemptedFamilies = new Set<string>();
  const maximumAttempts = Math.max(
    1,
    Math.min(
      Math.trunc(options.maximumAttempts || INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS),
      INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS,
    ),
  );
  let paidAttempts = 0;

  for (const candidate of candidates) {
    const family = String(candidate.family || "unknown").trim().toLowerCase();

    if (!candidate.configured) {
      attempts.push({
        provider: candidate.provider,
        family,
        status: "not_configured",
        message: "not_configured",
      });
      continue;
    }

    if (attemptedFamilies.has(family)) {
      attempts.push({
        provider: candidate.provider,
        family,
        status: "skipped",
        message: "duplicate_family",
      });
      continue;
    }

    if (paidAttempts >= maximumAttempts) {
      attempts.push({
        provider: candidate.provider,
        family,
        status: "skipped",
        message: "attempt_budget_exhausted",
      });
      continue;
    }

    attemptedFamilies.add(family);
    paidAttempts += 1;

    try {
      const value = await candidate.run();
      attempts.push({
        provider: candidate.provider,
        family,
        status: "completed",
        message: null,
      });
      return {
        value,
        provider: candidate.provider,
        family,
        attempts,
      };
    } catch (error) {
      attempts.push({
        provider: candidate.provider,
        family,
        status: "error",
        message: sanitizeInstaCompProviderFailure(error),
      });
    }
  }

  const failureSummary = attempts
    .filter((attempt) => attempt.status === "error")
    .map((attempt) => `${attempt.provider}:${attempt.message || "provider_error"}`)
    .join(", ");
  const error = new Error(
    failureSummary
      ? `No configured InstaComp AI identity reader completed successfully. Reader failures: ${failureSummary}.`
      : "No configured InstaComp AI identity reader completed successfully.",
  ) as Error & { code?: string; attempts?: InstaCompAiProviderAttempt[] };
  error.code = "INSTACOMP_AI_READERS_UNAVAILABLE";
  error.attempts = attempts;
  throw error;
}

export async function optionalInstaCompProviderResult<T>(
  operation: Promise<T>,
): Promise<T | null> {
  try {
    return await operation;
  } catch {
    return null;
  }
}
