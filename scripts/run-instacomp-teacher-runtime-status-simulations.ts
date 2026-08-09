import assert from "node:assert/strict";
import {
  resolveInstaCompTeacherRuntimeConfiguration,
  teacherRequiredVotes,
} from "../src/lib/instacomp-teacher-runtime-status";

assert.equal(teacherRequiredVotes(0), 2);
assert.equal(teacherRequiredVotes(1), 2);
assert.equal(teacherRequiredVotes(2), 2);
assert.equal(teacherRequiredVotes(3), 2);
assert.equal(teacherRequiredVotes(4), 3);

const none = resolveInstaCompTeacherRuntimeConfiguration({});
assert.equal(none.votingTeacherCount, 0);
assert.equal(none.requiredVotes, 2);
assert.equal(none.teacherConsensusOperational, false);
assert.equal(none.gatewayOidcAvailable, false);
assert.equal(none.macLearningBridgeConfigured, false);

const gatewayOnly = resolveInstaCompTeacherRuntimeConfiguration({
  VERCEL_OIDC_TOKEN: "oidc-token",
  INSTACOMP_AI_LOCAL_URL: "https://instacomp.truelycollectables.com",
  INSTACOMP_AI_LOCAL_KEY: "local-key",
});
assert.equal(gatewayOnly.gatewayOidcAvailable, true);
assert.equal(gatewayOnly.gatewayGoogleConfigured, true);
assert.equal(gatewayOnly.gatewayXaiConfigured, true);
assert.equal(gatewayOnly.votingTeacherCount, 2);
assert.equal(gatewayOnly.requiredVotes, 2);
assert.equal(gatewayOnly.teacherConsensusOperational, true);
assert.equal(gatewayOnly.macLearningBridgeConfigured, true);

const one = resolveInstaCompTeacherRuntimeConfiguration({
  GEMINI_API_KEY: "gemini",
  INSTACOMP_AI_LOCAL_URL: "https://instacomp.truelycollectables.com",
  INSTACOMP_AI_LOCAL_KEY: "local-key",
});
assert.equal(one.geminiConfigured, true);
assert.equal(one.gatewayGoogleConfigured, false);
assert.equal(one.votingTeacherCount, 1);
assert.equal(one.teacherConsensusOperational, false);
assert.equal(one.macLearningBridgeConfigured, true);

const duplicateProviderFamiliesDoNotDoubleVote =
  resolveInstaCompTeacherRuntimeConfiguration({
    VERCEL_OIDC_TOKEN: "oidc-token",
    GEMINI_API_KEY: "gemini-direct",
    XAI_API_KEY: "xai-direct",
  });
assert.equal(duplicateProviderFamiliesDoNotDoubleVote.gatewayGoogleConfigured, false);
assert.equal(duplicateProviderFamiliesDoNotDoubleVote.gatewayXaiConfigured, false);
assert.equal(duplicateProviderFamiliesDoNotDoubleVote.votingTeacherCount, 2);
assert.equal(duplicateProviderFamiliesDoNotDoubleVote.requiredVotes, 2);
assert.equal(duplicateProviderFamiliesDoNotDoubleVote.teacherConsensusOperational, true);

const two = resolveInstaCompTeacherRuntimeConfiguration({
  GOOGLE_GEMINI_API_KEY: "gemini",
  ANTHROPIC_API_KEY: "claude",
  PERPLEXITY_API_KEY: "perplexity",
  OPENAI_API_KEY: "openai",
  SERPAPI_API_KEY: "serp",
  GOOGLE_CUSTOM_SEARCH_API_KEY: "google",
  GOOGLE_CUSTOM_SEARCH_CX: "cx",
  INSTACOMP_AI_LOCAL_URL: "https://instacomp.truelycollectables.com",
  INSTACOMP_AI_LOCAL_KEY: "local-key",
});
assert.equal(two.votingTeacherCount, 2);
assert.equal(two.requiredVotes, 2);
assert.equal(two.teacherConsensusOperational, true);
assert.equal(two.perplexityConfigured, true);
assert.equal(two.openAiConfigured, true);
assert.equal(two.serpApiConfigured, true);
assert.equal(two.googleCseConfigured, true);

const invalidMac = resolveInstaCompTeacherRuntimeConfiguration({
  VERCEL_OIDC_TOKEN: "oidc-token",
  INSTACOMP_AI_LOCAL_URL: "https://example.com",
  INSTACOMP_AI_LOCAL_KEY: "local-key",
});
assert.equal(invalidMac.teacherConsensusOperational, true);
assert.equal(invalidMac.macLearningBridgeConfigured, false);

console.log("InstaComp teacher runtime configuration regressions passed.");
