export type InstaCompAiProviderCandidate<T> = {
  provider: string;
  family: string;
  configured: boolean;
  run: () => Promise<T>;
};

export type InstaCompAiProviderAttempt = {
  provider: string;
  family: string;
  status: "completed" | "not_configured" | "error";
  message: string | null;
};

export async function runInstaCompPrimaryAiFailover<T>(
  candidates: InstaCompAiProviderCandidate<T>[],
) {
  const attempts: InstaCompAiProviderAttempt[] = [];

  for (const candidate of candidates) {
    if (!candidate.configured) {
      attempts.push({
        provider: candidate.provider,
        family: candidate.family,
        status: "not_configured",
        message: "Provider is not configured.",
      });
      continue;
    }

    try {
      const value = await candidate.run();
      attempts.push({
        provider: candidate.provider,
        family: candidate.family,
        status: "completed",
        message: null,
      });
      return {
        value,
        provider: candidate.provider,
        family: candidate.family,
        attempts,
      };
    } catch (error) {
      attempts.push({
        provider: candidate.provider,
        family: candidate.family,
        status: "error",
        message: String(error instanceof Error ? error.message : error).slice(0, 500),
      });
    }
  }

  const error = new Error(
    "No configured InstaComp AI identity reader completed successfully.",
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
