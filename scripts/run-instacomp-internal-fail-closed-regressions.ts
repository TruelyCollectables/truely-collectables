import assert from "node:assert/strict";
import {
  runInstaCompPrimaryAiFailover,
  type InstaCompAiFailoverError,
} from "../src/lib/instacomp-ai-provider-failover";

// This regression runs against the committed runtime files, not a temporary patch.
async function expectFailure(
  operation: Promise<unknown>,
  code: string,
) {
  try {
    await operation;
    assert.fail(`Expected ${code}.`);
  } catch (error) {
    const failure = error as InstaCompAiFailoverError;
    assert.equal(failure.code, code);
    return failure;
  }
}

async function main() {
  let openAiCalls = 0;

  await expectFailure(
    runInstaCompPrimaryAiFailover([
      {
        provider: "instacomp_internal",
        family: "instacomp_internal",
        configured: false,
        run: async () => ({ source: "should_not_run" }),
      },
      {
        provider: "openai_emergency",
        family: "openai",
        configured: true,
        run: async () => {
          openAiCalls += 1;
          return { source: "openai" };
        },
      },
    ]),
    "INSTACOMP_INTERNAL_ENGINE_NOT_CONFIGURED",
  );
  assert.equal(openAiCalls, 0, "Missing Mac configuration must not call OpenAI.");

  await expectFailure(
    runInstaCompPrimaryAiFailover([
      {
        provider: "instacomp_internal",
        family: "instacomp_internal",
        configured: true,
        run: async () => {
          throw new Error("fetch failed: ECONNREFUSED");
        },
      },
      {
        provider: "openai_emergency",
        family: "openai",
        configured: true,
        run: async () => {
          openAiCalls += 1;
          return { source: "openai" };
        },
      },
    ]),
    "INSTACOMP_INTERNAL_ENGINE_OFFLINE",
  );
  assert.equal(openAiCalls, 0, "A dead Mac tunnel must not call OpenAI.");

  const emergency = await runInstaCompPrimaryAiFailover([
    {
      provider: "instacomp_internal",
      family: "instacomp_internal",
      configured: true,
      run: async () => {
        throw new Error(
          "InstaComp internal engine returned model_unavailable without usable identity evidence.",
        );
      },
    },
    {
      provider: "openai_emergency",
      family: "openai",
      configured: true,
      run: async () => {
        openAiCalls += 1;
        return { source: "openai_emergency" };
      },
    },
  ]);
  assert.equal(emergency.provider, "openai_emergency");
  assert.equal(openAiCalls, 1, "OpenAI may run only after explicit local model failure.");

  const internal = await runInstaCompPrimaryAiFailover([
    {
      provider: "instacomp_internal",
      family: "instacomp_internal",
      configured: true,
      run: async () => ({ source: "instacomp_internal" }),
    },
    {
      provider: "openai_emergency",
      family: "openai",
      configured: true,
      run: async () => {
        openAiCalls += 1;
        return { source: "openai" };
      },
    },
  ]);
  assert.equal(internal.provider, "instacomp_internal");
  assert.equal(openAiCalls, 1, "A successful internal scan must not call OpenAI.");

  console.log(
    "InstaComp fail-closed regressions passed: missing/offline Mac never reaches OpenAI; explicit local model failure may use emergency OpenAI.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
