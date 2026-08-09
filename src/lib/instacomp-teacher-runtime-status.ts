export type InstaCompTeacherRuntimeConfiguration = {
  geminiConfigured: boolean;
  anthropicConfigured: boolean;
  xaiConfigured: boolean;
  groqConfigured: boolean;
  perplexityConfigured: boolean;
  gatewayOidcAvailable: boolean;
  gatewayGoogleConfigured: boolean;
  gatewayXaiConfigured: boolean;
  openAiConfigured: boolean;
  serpApiConfigured: boolean;
  googleCseConfigured: boolean;
  votingTeacherCount: number;
  requiredVotes: number;
  teacherConsensusOperational: boolean;
  macLearningBridgeConfigured: boolean;
};

function configured(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function validMacTunnel(value: unknown) {
  const candidate = String(value || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^/]+\.truelycollectables\.com$/i.test(candidate);
}

export function teacherRequiredVotes(votingTeacherCount: number) {
  if (votingTeacherCount < 2) return 2;
  return Math.floor(votingTeacherCount / 2) + 1;
}

export function resolveInstaCompTeacherRuntimeConfiguration(
  env: Record<string, string | undefined> = process.env,
): InstaCompTeacherRuntimeConfiguration {
  const geminiConfigured = configured(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY);
  const anthropicConfigured = configured(env.ANTHROPIC_API_KEY);
  const xaiConfigured = configured(env.XAI_API_KEY);
  const groqConfigured = configured(env.GROQ_API_KEY);
  const perplexityConfigured = configured(env.PERPLEXITY_API_KEY);

  // Vercel provisions short-lived OIDC for deployed Functions automatically.
  // The AI SDK consumes it internally; depending on runtime it is not guaranteed
  // to be readable as a normal env variable. VERCEL=1 therefore means Gateway
  // platform auth is expected, while the protected live smoke proves real access.
  const gatewayOidcAvailable = Boolean(
    env.VERCEL === "1" ||
      configured(env.AI_GATEWAY_API_KEY) ||
      configured(env.VERCEL_OIDC_TOKEN),
  );
  const gatewayGoogleConfigured = gatewayOidcAvailable && !geminiConfigured;
  const gatewayXaiConfigured = gatewayOidcAvailable && !xaiConfigured;
  const openAiConfigured = configured(env.OPENAI_API_KEY);
  const serpApiConfigured = configured(env.SERPAPI_API_KEY);
  const googleCseConfigured = Boolean(
    configured(env.GOOGLE_CSE_API_KEY || env.GOOGLE_CUSTOM_SEARCH_API_KEY) &&
      configured(env.GOOGLE_CSE_CX || env.GOOGLE_CUSTOM_SEARCH_CX),
  );

  // Provider families count once. Direct Google/xAI credentials suppress their
  // matching Gateway adapters so one underlying provider can never cast two votes.
  const votingTeacherCount = [
    geminiConfigured || gatewayGoogleConfigured,
    anthropicConfigured,
    xaiConfigured || gatewayXaiConfigured,
    groqConfigured,
  ].filter(Boolean).length;
  const requiredVotes = teacherRequiredVotes(votingTeacherCount);
  const macLearningBridgeConfigured = Boolean(
    validMacTunnel(env.INSTACOMP_AI_LOCAL_URL) && configured(env.INSTACOMP_AI_LOCAL_KEY),
  );

  return {
    geminiConfigured,
    anthropicConfigured,
    xaiConfigured,
    groqConfigured,
    perplexityConfigured,
    gatewayOidcAvailable,
    gatewayGoogleConfigured,
    gatewayXaiConfigured,
    openAiConfigured,
    serpApiConfigured,
    googleCseConfigured,
    votingTeacherCount,
    requiredVotes,
    teacherConsensusOperational: votingTeacherCount >= requiredVotes,
    macLearningBridgeConfigured,
  };
}
