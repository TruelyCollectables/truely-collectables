export type InstaCompTeacherRuntimeConfiguration = {
  geminiConfigured: boolean;
  anthropicConfigured: boolean;
  xaiConfigured: boolean;
  groqConfigured: boolean;
  groqBrowserConfigured: boolean;
  openRouterConfigured: boolean;
  cloudflareConfigured: boolean;
  perplexityConfigured: boolean;
  openAiConfigured: boolean;
  serpApiConfigured: boolean;
  googleCseConfigured: boolean;
  votingTeacherCount: number;
  requiredVotes: number;
  teacherConsensusOperational: boolean;
  macLearningBridgeConfigured: boolean;
  onlineCompLearnMode: true;
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
  const groqBrowserConfigured = groqConfigured;
  const openRouterConfigured = configured(env.OPENROUTER_API_KEY);
  const cloudflareConfigured = Boolean(
    configured(env.CLOUDFLARE_ACCOUNT_ID) && configured(env.CLOUDFLARE_AUTH_TOKEN || env.CLOUDFLARE_API_TOKEN),
  );
  const perplexityConfigured = configured(env.PERPLEXITY_API_KEY);
  const openAiConfigured = configured(env.OPENAI_API_KEY);
  const serpApiConfigured = configured(env.SERPAPI_API_KEY);
  const googleCseConfigured = Boolean(
    configured(env.GOOGLE_CSE_API_KEY || env.GOOGLE_CUSTOM_SEARCH_API_KEY) &&
      configured(env.GOOGLE_CSE_CX || env.GOOGLE_CUSTOM_SEARCH_CX),
  );
  const votingTeacherCount = [
    geminiConfigured,
    anthropicConfigured,
    xaiConfigured,
    groqConfigured,
    groqBrowserConfigured,
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
    groqBrowserConfigured,
    openRouterConfigured,
    cloudflareConfigured,
    perplexityConfigured,
    openAiConfigured,
    serpApiConfigured,
    googleCseConfigured,
    votingTeacherCount,
    requiredVotes,
    teacherConsensusOperational: votingTeacherCount >= requiredVotes,
    macLearningBridgeConfigured,
    onlineCompLearnMode: true,
  };
}
