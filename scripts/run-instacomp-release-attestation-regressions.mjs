import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveReleaseCommit,
  writeInstaCompReleaseManifest,
} from "./write-instacomp-release-manifest.mjs";
import {
  normalizeExpectedCommit,
  verifyInstaCompReleasePayload,
} from "./check-live-instacomp-release.mjs";

const exactCommit = "a".repeat(40);
const staleCommit = "b".repeat(40);
const directory = mkdtempSync(join(tmpdir(), "instacomp-release-attestation-"));
const manifestPath = join(directory, "instacomp-release.json");

try {
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schema: "tcos.instacomp.release.v1",
        backendRelease: "evidence-first-95-ai-council-30",
        identityThreshold: 0.95,
        requiresBackImage: true,
        compSearchRequiresConfirmedIdentity: true,
        learningRequiresConfirmedIdentity: true,
        aiCouncilDefaultReaders: 8,
        aiCouncilMaxReaders: 30,
        aiCouncilFamilyVoteCap: true,
        aiCouncilReserveReaders: true,
        aiCouncilCustomProviderSlots: 14,
        sourceCommit: "BUILD_INJECTED_AT_BUILD",
      },
      null,
      2,
    )}\n`,
  );

  const written = writeInstaCompReleaseManifest({
    commit: exactCommit,
    manifestPath,
  });
  assert.equal(written.sourceCommit, exactCommit);
  assert.equal(
    JSON.parse(readFileSync(manifestPath, "utf8")).sourceCommit,
    exactCommit,
  );
  verifyInstaCompReleasePayload(written, exactCommit);
  assert.throws(
    () => verifyInstaCompReleasePayload(written, staleCommit),
    /sourceCommit/,
    "A live manifest from a different commit must fail attestation",
  );
  assert.throws(
    () => normalizeExpectedCommit("main"),
    /40-character Git SHA/,
  );
  assert.throws(
    () => resolveReleaseCommit("not-a-sha"),
    /40-character hexadecimal Git SHA/,
  );
  assert.throws(
    () =>
      writeInstaCompReleaseManifest({
        commit: exactCommit,
        manifestPath: join(directory, "missing.json"),
      }),
  );

  console.log("InstaComp exact-commit release attestation regressions passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
