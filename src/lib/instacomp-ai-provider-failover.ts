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

export type InstaCompAiFailoverError = Error & {
  code?: string;
  attempts?: InstaCompAiProviderAttempt[];
};

export const INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS = 5;

const INTERNAL_FAMILY = "instacomp_internal";
const INTERNAL_PROVIDER = "instacomp_internal";

function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error).trim();
}

export function sanitizeInstaCompProviderFailure(error: unknown) {
  const text = errorText(error).toLowerCase();
  if (/internal engine.*not configured|instacomp_ai_local_url/.test(text)) {
    return "internal_engine_not_configured";
  }
  if (/internal engine.*offline|fetch failed|econnrefused|enotfound|network/.test(text)) {
    return "internal_engine_unreachable";
  }
  if (/abort|cancel/.test(text)) return "cancelled";
  if (/timeout|timed out|deadline/.test(text)) return "timeout";
  if (/quota|rate.?limit|too many requests|\b429\b/.test(text)) {
    return "quota_or_rate_limit";
  }
  if (/model.*not found|does not exist|not.*access|unsupported model/.test(text)) {
    return "model_unavailable";
  }
  if (/unauthori[sz]ed|forbidden|invalid api key|\b401\b|\b403\b/.test(text)) {
    return "authentication_failed";
  }
  if (/unavailable|overloaded|gateway|\b50[0234]\b/.test(text)) {
    return "provider_unavailable";
  }
  if (/json|schema|no scan content|invalid response/.test(text)) {
    return "invalid_provider_response";
  }
  return "provider_error";
}

function isInternalCandidate(candidate: InstaCompAiProviderCandidate<unknown>) {
  return (
    String(candidate.family || "").trim().toLowerCase() === INTERNAL_FAMILY ||
    String(candidate.provider || "").trim().toLowerCase() === INTERNAL_PROVIDER
  );
}

/**
 * Run the preferred InstaComp identity reader first, then fail over across
 * independent configured reader families. The internal/Mac reader remains the
 * first choice, but an unavailable or inconclusive internal result must not
 * prevent a configured external vision reader from producing evidence.
 *
 * Trust is still enforced downstream by the Registry exact-lock and evidence
 * guards. This function chooses a reader; it does not make an identity trusted.
 */
export async function runInstaCompPrimaryAiFailover<T>(
  candidates: InstaCompAiProviderCandidate<T>[],
  options: { maximumAttempts?: number } = {},
) {
  const attempts: InstaCompAiProviderAttempt[] = [];
  const attemptedFamilies = new Set<string>();
  const maximumAttempts = Math.max(
    1,
    Math.min(
      Math.trunc(
        options.maximumAttempts || INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS,
      ),
      INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS,
    ),
  );
  let paidAttempts = 0;

  for (const candidate of candidates) {
    const family = String(candidate.family || "unknown").trim().toLowerCase();
    const internalCandidate = isInternalCandidate(candidate);

    if (!candidate.configured) {
      attempts.push({
        provider: candidate.provider,
        family,
        status: "not_configured",
        message: internalCandidate
          ? "internal_engine_not_configured"
          : "not_configured",
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
      return { value, provider: candidate.provider, family, attempts };
    } catch (error) {
      const sanitized = sanitizeInstaCompProviderFailure(error);
      attempts.push({
        provider: candidate.provider,
        family,
        status: "error",
        message: sanitized,
      });
      // Deliberately continue. The Mac/internal engine is preferred, not a
      // single point of failure. Independent readers remain subject to the
      // same downstream Registry and exact-card evidence gates.
    }
  }

  const summary = attempts
    .filter((attempt) => attempt.status === "error")
    .map(
      (attempt) =>
        `${attempt.provider}:${attempt.message || "provider_error"}`,
    )
    .join(", ");
  const configuredAttemptCount = attempts.filter(
    (attempt) => attempt.status === "completed" || attempt.status === "error",
  ).length;
  const internalAttempt = attempts.find(
    (attempt) =>
      attempt.family === INTERNAL_FAMILY || attempt.provider === INTERNAL_PROVIDER,
  );
  const error = new Error(
    summary
      ? `No configured InstaComp AI identity reader completed successfully. Reader failures: ${summary}.`
      : configuredAttemptCount === 0 && internalAttempt?.status === "not_configured"
        ? "No InstaComp AI identity reader is configured. Configure the secure Mac reader and/or an approved external vision reader."
        : "No configured InstaComp AI identity reader completed successfully.",
  ) as InstaCompAiFailoverError;
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
