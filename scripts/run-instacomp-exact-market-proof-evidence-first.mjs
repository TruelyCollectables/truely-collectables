import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(
  scriptsDir,
  "run-instacomp-exact-market-proof-regressions.ts",
);
const generatedPath = resolve(
  scriptsDir,
  ".run-instacomp-exact-market-proof-evidence-first.generated.ts",
);

const staleAssertion = `assert.ok(
  scanSource.includes(
    "const compSearchDecision = decideInstaCompCompSearch(consensus);",
  ),
);`;
const evidenceFirstAssertions = `assert.ok(
  scanSource.includes(
    "const consensusCompSearchDecision = decideInstaCompCompSearch(consensus);",
  ),
);
assert.ok(
  scanSource.includes("const compSearchDecision = identityDecision.confirmed"),
);
assert.ok(scanSource.includes("threshold: 0.95"));`;

const source = readFileSync(sourcePath, "utf8");
const occurrences = source.split(staleAssertion).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected one stale pre-evidence comp-search assertion, found ${occurrences}.`,
  );
}

writeFileSync(
  generatedPath,
  source.replace(staleAssertion, evidenceFirstAssertions),
  "utf8",
);

try {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", generatedPath],
    {
      cwd: resolve(scriptsDir, ".."),
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  unlinkSync(generatedPath);
}
