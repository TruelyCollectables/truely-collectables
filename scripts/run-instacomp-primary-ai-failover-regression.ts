import assert from "node:assert/strict";
import {
  optionalInstaCompProviderResult,
  runInstaCompPrimaryAiFailover,
} from "../src/lib/instacomp-ai-provider-failover";

async function main() {
  const calls: string[] = [];
  const fallback = await runInstaCompPrimaryAiFailover([
    {
      provider: "openai_primary",
      family: "openai",
      configured: true,
      run: async () => {
        calls.push("openai");
        throw new Error("OpenAI scan failed: insufficient_quota");
      },
    },
    {
      provider: "gemini",
      family: "google",
      configured: true,
      run: async () => {
        calls.push("gemini");
        return { player: "Shedeur Sanders", confidence: 0.98 };
      },
    },
    {
      provider: "groq",
      family: "groq",
      configured: true,
      run: async () => {
        calls.push("groq");
        return { player: "wrong" };
      },
    },
  ]);

  assert.deepEqual(calls, ["openai", "gemini"]);
  assert.equal(fallback.provider, "gemini");
  assert.equal(fallback.family, "google");
  assert.equal(fallback.value.player, "Shedeur Sanders");
  assert.deepEqual(
    fallback.attempts.map((attempt) => [attempt.provider, attempt.status]),
    [
      ["openai_primary", "error"],
      ["gemini", "completed"],
    ],
  );

  const preferred = await runInstaCompPrimaryAiFailover([
    {
      provider: "openai_primary",
      family: "openai",
      configured: true,
      run: async () => ({ player: "Connor Bedard" }),
    },
    {
      provider: "gemini",
      family: "google",
      configured: true,
      run: async () => ({ player: "should not run" }),
    },
  ]);
  assert.equal(preferred.provider, "openai_primary");
  assert.equal(preferred.value.player, "Connor Bedard");

  const optional = await optionalInstaCompProviderResult(
    Promise.reject(new Error("OpenAI serial OCR quota exhausted")),
  );
  assert.equal(optional, null);

  await assert.rejects(
    () =>
      runInstaCompPrimaryAiFailover([
        {
          provider: "openai_primary",
          family: "openai",
          configured: true,
          run: async () => {
            throw new Error("quota");
          },
        },
        {
          provider: "gemini",
          family: "google",
          configured: false,
          run: async () => ({ player: "never" }),
        },
      ]),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "INSTACOMP_AI_READERS_UNAVAILABLE",
      );
      return true;
    },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        primaryPreferred: preferred.provider,
        quotaFallback: fallback.provider,
        optionalProviderFailure: optional,
        independentFamilyPreserved: fallback.family !== "openai",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
