import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseUpperDeckOfficialHtmlChecklist } from "../src/lib/checklist-registry/upper-deck-official-html";
import type {
  ChecklistImportPlan,
  ChecklistSourceArtifact,
} from "../src/lib/checklist-registry/source-adapter";

type ExpectedIdentity = {
  label: string;
  setName: string;
  cardNumber: string;
  parallel: string;
  serialRun?: string;
  autographStatus?: string;
};

type SourceDefinition = {
  id: string;
  url: string;
  filename: string;
  minimums: {
    sets: number;
    cards: number;
    identities: number;
  };
  expectedIdentities: ExpectedIdentity[];
};

const SOURCES: SourceDefinition[] = [
  {
    id: "2024-25-upper-deck-series-1-hockey",
    url: "https://upperdeck.com/checklist/2024-25-ud-series-1-hockey-checklist/",
    filename: "2024-25-ud-series-1-hockey-checklist.html",
    minimums: { sets: 10, cards: 200, identities: 300 },
    expectedIdentities: [
      {
        label: "Lane Hutson Young Guns Base #229",
        setName: "young guns",
        cardNumber: "229",
        parallel: "base",
      },
      {
        label: "Lane Hutson Young Guns Clear Cut #229",
        setName: "young guns",
        cardNumber: "229",
        parallel: "clear cut",
      },
      {
        label: "Lane Hutson Young Guns Deluxe /250 #229",
        setName: "young guns",
        cardNumber: "229",
        parallel: "deluxe",
        serialRun: "/250",
      },
      {
        label: "Lane Hutson Canvas Young Guns C-111",
        setName: "ud canvas - young guns",
        cardNumber: "c-111",
        parallel: "base",
      },
    ],
  },
  {
    id: "2025-26-upper-deck-allure-hockey",
    url: "https://upperdeck.com/checklist/2025-2026-allure-hockey-checklist/",
    filename: "2025-2026-allure-hockey-checklist.html",
    minimums: { sets: 10, cards: 100, identities: 150 },
    expectedIdentities: [
      {
        label: "Ivan Demidov Allure Rookie Base #110",
        setName: "rookies",
        cardNumber: "110",
        parallel: "base",
      },
      {
        label: "Ivan Demidov Black Rainbow #110",
        setName: "rookies",
        cardNumber: "110",
        parallel: "black rainbow",
      },
      {
        label: "Ivan Demidov Gold Glitter Bomb /199 #110",
        setName: "rookies",
        cardNumber: "110",
        parallel: "gold glitter bomb",
        serialRun: "/199",
      },
      {
        label: "Ivan Demidov Hitting Thier Groove Auto",
        setName: "hitting thier groove",
        cardNumber: "htg-2",
        parallel: "auto",
        autographStatus: "autograph",
      },
    ],
  },
];

function normalized(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function findIdentity(plan: ChecklistImportPlan, expected: ExpectedIdentity) {
  return plan.identities.find((entry) => {
    const value = entry.fingerprint.normalized;
    return (
      value.setName === normalized(expected.setName) &&
      value.cardNumber === normalized(expected.cardNumber) &&
      value.parallel === normalized(expected.parallel) &&
      (expected.serialRun === undefined ||
        value.serialRun === expected.serialRun) &&
      (expected.autographStatus === undefined ||
        value.autographStatus === normalized(expected.autographStatus))
    );
  });
}

function parseOutputPath() {
  const flagIndex = process.argv.indexOf("--output");
  const supplied = flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  return resolve(
    process.cwd(),
    supplied || ".upper-deck-work/full-source-validation.json",
  );
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
    throw new Error(
      `${source.id} returned unexpected content type ${contentType || "unknown"}`,
    );
  }

  const html = await response.text();
  if (html.length < 10_000) {
    throw new Error(
      `${source.id} returned only ${html.length} bytes; refusing to treat it as a complete official checklist page`,
    );
  }
  return html;
}

function validatePlan(source: SourceDefinition, plan: ChecklistImportPlan) {
  const failures: string[] = [];
  if (plan.validation.status !== "passed") {
    failures.push(`validation status is ${plan.validation.status}`);
  }
  const errors = plan.validation.issues.filter(
    (entry) => entry.severity === "error",
  );
  if (errors.length) {
    failures.push(
      `validation contains ${errors.length} error(s): ${errors
        .map((entry) => `${entry.code}: ${entry.message}`)
        .join(" | ")}`,
    );
  }
  if (
    plan.validation.issues.some((entry) => entry.code === "test_batch_only")
  ) {
    failures.push("live official source was incorrectly marked as a test batch");
  }

  const counts = plan.validation.counts;
  if (counts.sets < source.minimums.sets) {
    failures.push(`sets ${counts.sets} < minimum ${source.minimums.sets}`);
  }
  if (counts.cards < source.minimums.cards) {
    failures.push(`cards ${counts.cards} < minimum ${source.minimums.cards}`);
  }
  if (counts.identities < source.minimums.identities) {
    failures.push(
      `identities ${counts.identities} < minimum ${source.minimums.identities}`,
    );
  }
  if (counts.identities < counts.cards) {
    failures.push(
      `identities ${counts.identities} cannot be lower than cards ${counts.cards}`,
    );
  }

  const fingerprints = plan.identities.map(
    (entry) => entry.fingerprint.fingerprintSha256,
  );
  if (new Set(fingerprints).size !== fingerprints.length) {
    failures.push("duplicate physical-printing fingerprints were generated");
  }

  const expectedIdentities = source.expectedIdentities.map((expected) => {
    const match = findIdentity(plan, expected);
    if (!match) failures.push(`missing required identity: ${expected.label}`);
    return {
      label: expected.label,
      found: Boolean(match),
      fingerprintSha256: match?.fingerprint.fingerprintSha256 || null,
    };
  });

  return { failures, expectedIdentities };
}

async function main() {
  const retrievedAt = new Date().toISOString();
  const results = [];

  for (const source of SOURCES) {
    const html = await fetchOfficialHtml(source);
    const artifact: ChecklistSourceArtifact = {
      sourceUrl: source.url,
      originalFilename: source.filename,
      mimeType: "text/html",
      content: html,
      retrievedAt,
      authority: "official_manufacturer",
      redistributionAllowed: false,
    };
    const plan = parseUpperDeckOfficialHtmlChecklist(artifact);
    const validation = validatePlan(source, plan);

    results.push({
      id: source.id,
      sourceUrl: source.url,
      retrievedAt,
      source: {
        sha256: plan.source.storage.sha256,
        sizeBytes: plan.source.storage.sizeBytes,
        mimeType: plan.source.storage.mimeType,
        privateArchiveRequired: plan.source.privateArchiveRequired,
        isPublic: plan.source.storage.isPublic,
      },
      adapter: {
        id: plan.adapterId,
        version: plan.adapterVersion,
      },
      release: plan.release,
      counts: plan.validation.counts,
      warningCodes: plan.validation.issues
        .filter((entry) => entry.severity === "warning")
        .map((entry) => entry.code),
      expectedIdentities: validation.expectedIdentities,
      failures: validation.failures,
    });
  }

  const failures = results.flatMap((entry) =>
    entry.failures.map((failure) => `${entry.id}: ${failure}`),
  );
  const receipt = {
    schema: "tcos.checklist.upperDeckFullSourceValidation.v1",
    generatedAt: new Date().toISOString(),
    status: failures.length ? "failed" : "passed",
    sourceCount: results.length,
    results,
    failures,
    safety: {
      productionDatabaseWrites: false,
      migrationsApplied: false,
      deploymentPerformed: false,
      rawOfficialHtmlIncludedInReceipt: false,
    },
  };

  const outputPath = parseOutputPath();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exitCode = 1;
});
