import assert from "node:assert/strict";
import {
  runInstaCompPrimaryAiFailover,
  type InstaCompAiFailoverError,
} from "../src/lib/instacomp-ai-provider-failover";

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
  let externalCalls = 0;
  const externalCandidate = {
    provider: "external_identity_reader",
    family: "external",
    configured: true,
    run: async () => {
      externalCalls += 1;
      return { source: "external" };
    },
  };

  await expectFailure(
    runInstaCompPrimaryAiFailover([
      {
        provider: "instacomp_internal",
        family: "instacomp_internal",
        configured: false,
        run: async () => ({ source: "should_not_run" }),
      },
      externalCandidate,
    ]),
    "INSTACOMP_INTERNAL_ENGINE_NOT_CONFIGURED",
  );
  assert.equal(externalCalls, 0);

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
      externalCandidate,
    ]),
    "INSTACOMP_INTERNAL_ENGINE_OFFLINE",
  );
  assert.equal(externalCalls, 0);

  await expectFailure(
    runInstaCompPrimaryAiFailover([
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
      externalCandidate,
    ]),
    "INSTACOMP_INTERNAL_ENGINE_SCAN_FAILED",
  );
  assert.equal(externalCalls, 0);

  const internal = await runInstaCompPrimaryAiFailover([
    {
      provider: "instacomp_internal",
      family: "instacomp_internal",
      configured: true,
      run: async () => ({ source: "instacomp_internal" }),
    },
    externalCandidate,
  ]);
  assert.equal(internal.provider, "instacomp_internal");
  assert.equal(externalCalls, 0);

  console.log(
    "InstaComp fail-closed regressions passed: no internal outcome reaches an external identity reader.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
