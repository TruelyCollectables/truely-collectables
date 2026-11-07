import assert from "node:assert/strict";
import fs from "node:fs";
import {
  INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS,
  optionalInstaCompProviderResult,
  runInstaCompPrimaryAiFailover,
  sanitizeInstaCompProviderFailure,
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
        throw new Error("OpenAI scan failed: insufficient_quota secret=sk-live-do-not-leak");
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
    fallback.attempts.map((attempt) => [attempt.provider, attempt.status, attempt.message]),
    [
      ["openai_primary", "error", "quota_or_rate_limit"],
      ["gemini", "completed", null],
    ],
  );
  assert.equal(JSON.stringify(fallback.attempts).includes("sk-live"), false);

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

  const duplicateCalls: string[] = [];
  const deduplicatedFamily = await runInstaCompPrimaryAiFailover([
    {
      provider: "custom_1",
      family: "same-host.example",
      configured: true,
      run: async () => {
        duplicateCalls.push("custom_1");
        throw new Error("503 upstream details");
      },
    },
    {
      provider: "custom_2",
      family: "same-host.example",
      configured: true,
      run: async () => {
        duplicateCalls.push("custom_2");
        return { player: "must not run" };
      },
    },
    {
      provider: "ollama",
      family: "ollama",
      configured: true,
      run: async () => {
        duplicateCalls.push("ollama");
        return { player: "Fallback" };
      },
    },
  ]);
  assert.deepEqual(duplicateCalls, ["custom_1", "ollama"]);
  assert.equal(deduplicatedFamily.provider, "ollama");
  assert.deepEqual(
    deduplicatedFamily.attempts.map((attempt) => [attempt.provider, attempt.status, attempt.message]),
    [
      ["custom_1", "error", "provider_unavailable"],
      ["custom_2", "skipped", "duplicate_family"],
      ["ollama", "completed", null],
    ],
  );

  const budgetCalls: string[] = [];
  await assert.rejects(
    () => runInstaCompPrimaryAiFailover(
      Array.from({ length: INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS + 3 }, (_, index) => ({
        provider: `provider_${index}`,
        family: `family_${index}`,
        configured: true,
        run: async () => {
          budgetCalls.push(`provider_${index}`);
          throw new Error("provider failed");
        },
      })),
    ),
    (error: unknown) => {
      const attempts = (error as { attempts?: Array<{ status: string; message: string | null }> }).attempts || [];
      assert.equal(budgetCalls.length, INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS);
      assert.equal(
        attempts.filter((attempt) => attempt.message === "attempt_budget_exhausted").length,
        3,
      );
      return true;
    },
  );

  assert.equal(sanitizeInstaCompProviderFailure("401 api_key=secret"), "authentication_failed");
  assert.equal(sanitizeInstaCompProviderFailure("request deadline exceeded"), "timeout");

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

  const route = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
  for (const marker of [
    "primaryAiProvider: primaryAiResult.provider",
    "primaryAiFamily: primaryAiResult.family",
    "excludedFamilies: [primaryAiResult.family]",
    "family: params.primaryAiFamily",
    "sanitizeInstaCompProviderFailure(error)",
  ]) {
    assert.ok(route.includes(marker), `Missing failover hardening marker: ${marker}`);
  }
  assert.equal(
    /readerId: "primary_vision"[\s\S]{0,200}family: "openai"/.test(route),
    false,
    "Fallback primary identity must not be relabeled as an OpenAI family vote.",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        primaryPreferred: preferred.provider,
        quotaFallback: fallback.provider,
        optionalProviderFailure: optional,
        independentFamilyPreserved: true,
        duplicateFamilyCallsBlocked: true,
        attemptBudget: INSTACOMP_PRIMARY_FAILOVER_MAX_ATTEMPTS,
        diagnosticsSanitized: true,
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
