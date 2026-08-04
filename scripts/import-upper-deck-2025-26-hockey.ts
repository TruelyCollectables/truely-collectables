import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import { resolveChecklistRegistry } from "../src/lib/instacomp-learning-server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

type SourceDefinition = {
  id: string;
  url: string;
  filename: string;
};

const SOURCES: SourceDefinition[] = [
  ["2025-26-mvp-hockey", "https://upperdeck.com/checklist/2025-26-mvp-hockey-checklist/"],
  ["2025-26-chicago-blackhawks-100th-retail", "https://upperdeck.com/checklist/2025-2026-chicago-blackhawks-100th-anniversary-set-checklist-retail/"],
  ["2025-team-canada-juniors", "https://upperdeck.com/checklist/2025-team-canada-juniors-checklist/"],
  ["2025-26-artifacts", "https://upperdeck.com/checklist/2025-2026-artifacts-checklist/"],
  ["2025-26-upper-deck-series-1", "https://upperdeck.com/checklist/2025-26-ud-series-1-checklist/"],
  ["2025-26-tim-hortons", "https://upperdeck.com/checklist/2025-2026-tim-hortons-checklist/"],
  ["2025-26-detroit-red-wings-centennial-retail", "https://upperdeck.com/checklist/2025-2026-detroit-red-wings-centennial-set-checklist-retail/"],
  ["2025-26-black-diamond", "https://upperdeck.com/checklist/2025-2026-black-diamond-checklist/"],
  ["2025-26-o-pee-chee", "https://upperdeck.com/checklist/2025-26-o-pee-chee-checklist/"],
  ["2025-26-mvp-silver-collection", "https://upperdeck.com/checklist/2025-26-mvp-silver-collection-hockey-checklist/"],
  ["2025-26-allure", "https://upperdeck.com/checklist/2025-2026-allure-hockey-checklist/"],
  ["2025-26-chicago-blackhawks-100th-hobby", "https://upperdeck.com/checklist/chicago-blackhawks-100th-anniversary-set-checklist-hobby/"],
  ["2025-26-new-york-rangers-centennial-retail", "https://upperdeck.com/checklist/2025-26-nhl-new-york-rangers-centennial-checklist/"],
  ["2025-26-detroit-red-wings-centennial-hobby", "https://upperdeck.com/checklist/2025-2026-detroit-red-wings-centennial-set-checklist-hobby/"],
  ["2025-26-sp-game-used", "https://upperdeck.com/checklist/2025-26-sp-game-used-hockey-checklist/"],
  ["2025-26-artifacts-rookies", "https://upperdeck.com/checklist/2025-2026-artifacts-rookies-checklist/"],
  ["2025-26-sp-hockey", "https://upperdeck.com/checklist/2025-2026-sp-hockey-checklist/"],
  ["2025-26-upper-deck-series-2", "https://upperdeck.com/checklist/2025-26-upper-deck-series-2-checklist/"],
  ["2025-26-star-rookies-box-set", "https://upperdeck.com/checklist/2025-2026-nhl-star-rookies-box-set-checklist/"],
  ["2025-26-new-york-rangers-centennial-hobby", "https://upperdeck.com/checklist/2025-26-nhl-new-york-rangers-centennial-hobby-checklist/"],
  ["2025-26-flair", "https://upperdeck.com/checklist/2025-26-flair-hockey-checklist/"],
  ["2025-26-skybox-metal-universe", "https://upperdeck.com/checklist/2025-2026-skybox-metal-universe-hockey-checklist/"],
  ["2025-26-credentials", "https://upperdeck.com/checklist/2025-2026-credentials-checklist/"],
  ["2025-26-spx", "https://upperdeck.com/checklist/2025-2026-spx-checklist/"],
  ["2025-26-o-pee-chee-platinum", "https://upperdeck.com/checklist/2025-2026-o-pee-chee-platinum-checklist/"],
  ["2025-26-upper-deck-extended-series", "https://upperdeck.com/checklist/2025-26-ud-extended-series-checklist/"],
  ["2025-26-ahl", "https://upperdeck.com/checklist/2025-26-ahl-checklist/"],
  ["2025-26-chl-game-used", "https://upperdeck.com/checklist/2025-26-chl-game-used-checklist/"],
  ["2025-26-sp-authentic", "https://upperdeck.com/checklist/2025-26-sp-authentic-checklist/"],
  ["2025-26-parkhurst", "https://upperdeck.com/checklist/2025-26-parkhurst-checklist/"],
  ["2025-26-chl", "https://upperdeck.com/checklist/2025-26-chl-checklist/"],
  ["2025-26-ud-pwhl", "https://upperdeck.com/checklist/2025-26-ud-pwhl-checklist/"],
  ["2025-26-ultimate-collection", "https://upperdeck.com/checklist/2025-26-nhl-ultimate-collection-checklist/"],
].map(([id, url]) => ({ id, url, filename: `${id}.html` }));

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--confirm-season=2025-26-hockey");
const outputFlag = process.argv.indexOf("--output");
const OUTPUT = resolve(
  process.cwd(),
  outputFlag >= 0 && process.argv[outputFlag + 1]
    ? process.argv[outputFlag + 1]
    : ".upper-deck-work/2025-26-hockey-import-receipt.json",
);

async function fetchArtifact(source: SourceDefinition): Promise<ChecklistSourceArtifact> {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent": "TCOS-Checklist-Registry/1.0 (+private production import; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`${source.id} returned HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`${source.id} returned unexpected content type ${contentType || "unknown"}`);
  }

  const content = await response.text();
  if (content.length < 10_000) {
    throw new Error(`${source.id} returned only ${content.length} bytes; refusing incomplete source`);
  }

  return {
    sourceUrl: source.url,
    originalFilename: source.filename,
    mimeType: "text/html",
    content,
    retrievedAt: new Date().toISOString(),
    authority: "official_manufacturer",
    redistributionAllowed: false,
  };
}

async function validateSource(source: SourceDefinition, artifact: ChecklistSourceArtifact) {
  let result: Awaited<ReturnType<typeof importChecklistArtifact>>;
  try {
    result = await importChecklistArtifact({ artifact, validateOnly: true });
  } catch (error) {
    throw new Error(
      `${source.id} parser failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const errors = result.plan.validation.issues.filter((issue) => issue.severity === "error");
  if (!result.ok || result.plan.validation.status !== "passed" || errors.length) {
    throw new Error(`${source.id} failed validation: ${errors.map((issue) => `${issue.code}: ${issue.message}`).join(" | ") || result.plan.validation.status}`);
  }
  if (result.plan.validation.counts.cards < 1 || result.plan.validation.counts.identities < 1) {
    throw new Error(`${source.id} produced an empty normalized plan`);
  }
  return result;
}

async function verifyCanary() {
  const result = await resolveChecklistRegistry(
    {
      player: "Connor McDavid",
      year: "2025-26",
      brand: "Upper Deck",
      setName: "MVP Hockey Base Set",
      cardNumber: "1",
      parallel: "Base",
      team: "Edmonton Oilers",
      sport: "Hockey",
      league: "NHL",
      isAuto: false,
      isRelic: false,
    },
    { evidenceTrusted: true },
  );

  if (result.status !== "internal_exact_match" || !result.match) {
    throw new Error(`Canary verification failed with status ${result.status}: ${result.reasons.join(", ")}`);
  }
  return result;
}

async function main() {
  if (APPLY && !CONFIRMED) {
    throw new Error("Production import requires --apply --confirm-season=2025-26-hockey");
  }

  const receipt: Record<string, unknown> = {
    schema: "tcos.checklist.upperDeck2025_26HockeyImport.v1",
    startedAt: new Date().toISOString(),
    mode: APPLY ? "production_apply" : "validation_only",
    sourceCount: SOURCES.length,
    results: [],
    canary: null,
    safety: {
      validationBeforeWrites: true,
      canaryFirst: true,
      stopOnFirstFailure: true,
      sourceArchivePrivate: true,
      pricingImported: false,
    },
  };

  const prepared = [] as Array<{
    source: SourceDefinition;
    artifact: ChecklistSourceArtifact;
    validation: Awaited<ReturnType<typeof validateSource>>;
  }>;

  for (const source of SOURCES) {
    const artifact = await fetchArtifact(source);
    const validation = await validateSource(source, artifact);
    prepared.push({ source, artifact, validation });
    (receipt.results as unknown[]).push({
      id: source.id,
      sourceUrl: source.url,
      status: "validated",
      counts: validation.plan.validation.counts,
      sha256: validation.plan.source.storage.sha256,
      adapter: validation.adapter,
    });
  }

  if (APPLY) {
    const canarySource = prepared[0];
    const canaryImport = await importChecklistArtifact({ artifact: canarySource.artifact });
    const canaryVerification = await verifyCanary();
    receipt.canary = {
      id: canarySource.source.id,
      persistence: canaryImport.persistence,
      verificationStatus: canaryVerification.status,
      identityId: canaryVerification.match?.identityId || null,
    };

    for (const entry of prepared.slice(1)) {
      const imported = await importChecklistArtifact({ artifact: entry.artifact });
      const row = (receipt.results as Array<Record<string, unknown>>).find((item) => item.id === entry.source.id);
      if (row) {
        row.status = "imported";
        row.persistence = imported.persistence;
      }
    }

    const canaryRow = (receipt.results as Array<Record<string, unknown>>).find((item) => item.id === canarySource.source.id);
    if (canaryRow) {
      canaryRow.status = "imported_and_verified";
      canaryRow.persistence = canaryImport.persistence;
    }
  }

  receipt.completedAt = new Date().toISOString();
  receipt.status = "passed";
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  const failure = {
    schema: "tcos.checklist.upperDeck2025_26HockeyImport.v1",
    status: "failed",
    failedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
