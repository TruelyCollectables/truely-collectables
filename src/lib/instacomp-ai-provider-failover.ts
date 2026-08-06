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
 * OpenAI is an emergency teacher, not an infrastructure fallback.
 * It may run only when the Mac engine completed the request and explicitly
 * reported that its local Ollama backup was unavailable for this unknown card.
 */
export function isInstaCompInternalEmergencyEligible(error: unknown) {
  const text = errorText(error).toLowerCase();
  return /internal engine returned model_unavailable without usable identity evidence/.test(
    text,
  );
}

function internalEngineError(params: {
  code: string;
  message: string;
  attempts: InstaCompAiProviderAttempt[];
}) {
  const error = new Error(params.message) as InstaCompAiFailoverError;
  error.code = params.code;
  error.attempts = params.attempts;
  return error;
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

      if (internalCandidate) {
        throw internalEngineError({
          code: "INSTACOMP_INTERNAL_ENGINE_NOT_CONFIGURED",
          message:
            "InstaComp internal engine is not configured for Production. The scan was stopped before OpenAI emergency fallback. Configure INSTACOMP_AI_LOCAL_URL with the secure Mac service URL.",
          attempts,
        });
      }
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

      if (internalCandidate && !isInstaCompInternalEmergencyEligible(error)) {
        throw internalEngineError({
          code: "INSTACOMP_INTERNAL_ENGINE_OFFLINE",
          message:
            "InstaComp internal engine could not complete the scan. The scan was stopped before OpenAI emergency fallback. Check the Mac service and its secure tunnel, then retry.",
          attempts,
        });
      }
    }
  }

  const summary = attempts
    .filter((attempt) => attempt.status === "error")
    .map(
      (attempt) =>
        `${attempt.provider}:${attempt.message || "provider_error"}`,
    )
    .join(", ");
  const error = new Error(
    summary
      ? `No configured InstaComp AI identity reader completed successfully. Reader failures: ${summary}.`
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
