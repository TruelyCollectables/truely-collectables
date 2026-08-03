import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { importChecklistArtifact } from "../../src/lib/checklist-registry/server";
import type {
  ChecklistImportPlan,
  ChecklistSourceArtifact,
} from "../../src/lib/checklist-registry/source-adapter";

type SourceDefinition = {
  id: string;
  url: string;
  filename: string;
  expected: {
    releaseSlug: string;
    sets: number;
    cards: number;
    parallels: number;
    identities: number;
    fingerprints: string[];
  };
};

const EXPECTED_ADAPTER = "upper-deck-official-html-checklist";
const SOURCES: SourceDefinition[] = [
  {
    id: "2025-26-upper-deck-allure-hockey",
    url: "https://upperdeck.com/checklist/2025-2026-allure-hockey-checklist/",
    filename: "2025-2026-allure-hockey-checklist.html",
    expected: {
      releaseSlug: "2025-2026-allure-hockey-checklist",
      sets: 29,
      cards: 1_056,
      parallels: 80,
      identities: 2_900,
      fingerprints: [
        "0a23ea9b6145cdf06848581757744f3457be39e045c39ac574d2b873198f9753",
        "8745a58544a05a7db6cc5927aef9264e6d8c0da108220eada9b04a7addac6078",
        "f3b226690d0e01c556d9b3b1e03254e8934d11d527f14876b4f8d41f076fbb54",
        "37c9629f99665e30eb437a53dffcebdbd926ebaa83198cd4e494773ce4082aa0",
      ],
    },
  },
  {
    id: "2024-25-upper-deck-series-1-hockey",
    url: "https://upperdeck.com/checklist/2024-25-ud-series-1-hockey-checklist/",
    filename: "2024-25-ud-series-1-hockey-checklist.html",
    expected: {
      releaseSlug: "2024-25-ud-series-1-hockey-checklist",
      sets: 28,
      cards: 1_398,
      parallels: 66,
      identities: 4_418,
      fingerprints: [
        "ac52753699f82515e39bd65f7a8d29914de45a7c481e50b6fdd81a5b08dea104",
        "058ef272d8ca7d30bf7e3d39d6adda6331198f3a75c6b0b683a39ab67a53e03c",
        "7b4685ca5aff3fbe4e4d4ad744c01cf04041f840d249bdb19a21c085b16937a9",
        "c8908644316b81c5b488e1348507a7437560746db059364c7bc8cb4ff2d9d5d1",
      ],
    },
  },
];

function outputPath() {
  const index = process.argv.indexOf("--receipt");
  const supplied = index >= 0 ? process.argv[index + 1] : null;
  return resolve(
    process.cwd(),
    supplied || "evidence/upper-deck-normalized-digests.json",
  );
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sortBySourceKey<T extends { sourceKey: string }>(values: T[]) {
  return [...values].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
}

function normalizedPlanDigest(plan: ChecklistImportPlan) {
  const canonical = {
    schema: "tcos.checklist.normalizedDigest.v1",
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
    release: plan.release,
    sets: sortBySourceKey(plan.sets),
    cards: sortBySourceKey(plan.cards),
    parallels: sortBySourceKey(plan.parallels),
    identities: [...plan.identities].sort((left, right) => {
      const leftKey = `${left.cardSourceKey}|${left.parallelSourceKey || ""}|${left.fingerprint.fingerprintSha256}`;
      const rightKey = `${right.cardSourceKey}|${right.parallelSourceKey || ""}|${right.fingerprint.fingerprintSha256}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
  return sha256(JSON.stringify(canonical));
}

function requireExactPlan(plan: ChecklistImportPlan, source: SourceDefinition) {
  const actual = plan.validation.counts;
  const expected = source.expected;
  const failures: string[] = [];
  const comparisons: Array<[string, string | number, string | number]> = [
    ["releaseSlug", plan.release.releaseSlug, expected.releaseSlug],
    ["sets", actual.sets, expected.sets],
    ["cards", actual.cards, expected.cards],
    ["parallels", actual.parallels, expected.parallels],
    ["identities", actual.identities, expected.identities],
    ["adapterId", plan.adapterId, EXPECTED_ADAPTER],
  ];
  for (const [label, value, target] of comparisons) {
    if (value !== target) failures.push(`${label}=${value}, expected=${target}`);
  }
  if (plan.validation.status !== "passed") {
    failures.push(`validationStatus=${plan.validation.status}`);
  }
  for (const entry of plan.validation.issues) {
    if (entry.severity === "error") {
      failures.push(`${entry.code}: ${entry.message}`);
    }
  }

  const fingerprints = plan.identities.map(
    (entry) => entry.fingerprint.fingerprintSha256,
  );
  if (new Set(fingerprints).size !== fingerprints.length) {
    failures.push("duplicate physical-printing fingerprints generated");
  }
  for (const expectedFingerprint of expected.fingerprints) {
    if (!fingerprints.includes(expectedFingerprint)) {
      failures.push(`missing known fingerprint ${expectedFingerprint}`);
    }
  }
  if (failures.length) {
    throw new Error(`${source.id} validation blocked: ${failures.join(", ")}`);
  }
}

async function fetchOfficialHtml(source: SourceDefinition) {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent":
        "TCOS-Checklist-Registry/1.0 (+private validation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `${source.id} returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`${source.id} returned ${contentType || "unknown content type"}`);
  }
  const html = await response.text();
  const bytes = Buffer.from(html, "utf8");
  if (bytes.length < 500_000 || bytes.length > 2_000_000) {
    throw new Error(`${source.id} returned implausible size ${bytes.length}`);
  }
  return {
    html,
    rawSha256: sha256(bytes),
    rawSizeBytes: bytes.length,
  };
}

async function main() {
  if (!process.argv.includes("--observe-only")) {
    throw new Error("This revision is observation-only and requires --observe-only.");
  }

  const retrievedAt = new Date().toISOString();
  const sources = [];
  for (const source of SOURCES) {
    const fetched = await fetchOfficialHtml(source);
    const artifact: ChecklistSourceArtifact = {
      sourceUrl: source.url,
      originalFilename: source.filename,
      mimeType: "text/html",
      content: fetched.html,
      retrievedAt,
      authority: "official_manufacturer",
      redistributionAllowed: false,
    };
    const validation = await importChecklistArtifact({
      artifact,
      validateOnly: true,
    });
    requireExactPlan(validation.plan, source);

    const observedFingerprints = new Set(
      validation.plan.identities.map(
        (entry) => entry.fingerprint.fingerprintSha256,
      ),
    );
    sources.push({
      id: source.id,
      sourceUrl: source.url,
      rawSha256: fetched.rawSha256,
      rawSizeBytes: fetched.rawSizeBytes,
      normalizedPlanSha256: normalizedPlanDigest(validation.plan),
      adapter: validation.adapter,
      release: validation.plan.release,
      counts: validation.plan.validation.counts,
      knownIdentityProofs: source.expected.fingerprints.map((fingerprint) => ({
        fingerprint,
        found: observedFingerprints.has(fingerprint),
      })),
    });
  }

  const receipt = {
    schema: "tcos.checklist.upperDeckNormalizedDigestObservation.v1",
    generatedAt: new Date().toISOString(),
    status: "observed",
    sources,
    safety: {
      productionDatabaseReads: false,
      productionDatabaseWrites: false,
      migrationsApplied: false,
      deploymentPerformed: false,
      rawOfficialHtmlIncluded: false,
    },
  };
  const receiptPath = outputPath();
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exitCode = 1;
});
