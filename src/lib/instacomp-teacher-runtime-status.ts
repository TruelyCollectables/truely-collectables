export type InstaCompTeacherRuntimeConfiguration = {
  geminiConfigured: boolean;
  directGeminiConfigured: boolean;
  gatewayGeminiConfigured: boolean;
  anthropicConfigured: boolean;
  xaiConfigured: boolean;
  groqConfigured: boolean;
  groqBrowserConfigured: boolean;
  gatewayPerplexityConfigured: boolean;
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
  const directGeminiConfigured =
    String(env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() !== "true" &&
    configured(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY);
  const gatewayPlatformConfigured = Boolean(
    configured(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) || env.VERCEL === "1",
  );
  const gatewayGeminiConfigured =
    String(env.INSTACOMP_GATEWAY_GEMINI_DISABLED || "").trim().toLowerCase() !== "true" &&
    gatewayPlatformConfigured;
  const geminiConfigured = directGeminiConfigured || gatewayGeminiConfigured;
  const anthropicConfigured = configured(env.ANTHROPIC_API_KEY);
  const xaiConfigured = configured(env.XAI_API_KEY);
  const groqConfigured = configured(env.GROQ_API_KEY);
  // Compound and GPT-OSS browser search are two discovery lanes, but both are
  // backed by the same Groq credential/provider family and therefore count as
  // one independent trust vote.
  const groqBrowserConfigured = groqConfigured;
  const gatewayPerplexityConfigured = gatewayPlatformConfigured;
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
    gatewayPerplexityConfigured,
  ].filter(Boolean).length;
  const requiredVotes = teacherRequiredVotes(votingTeacherCount);
  const macLearningBridgeConfigured = Boolean(
    validMacTunnel(env.INSTACOMP_AI_LOCAL_URL) && configured(env.INSTACOMP_AI_LOCAL_KEY),
  );

  return {
    geminiConfigured,
    directGeminiConfigured,
    gatewayGeminiConfigured,
    anthropicConfigured,
    xaiConfigured,
    groqConfigured,
    groqBrowserConfigured,
    gatewayPerplexityConfigured,
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
