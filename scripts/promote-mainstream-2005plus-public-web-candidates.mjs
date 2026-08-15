import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { downloadAndParse } from "./mainstream-checklist/source-tools.mjs";
import {
  ARCHIVE_BUCKET,
  assertPlanComplexity,
  buildPlan,
  dbClient,
  ensureArchiveBucket,
  limitedIssues,
  persistPlan,
  uploadArchive,
  upsertCatalog,
} from "./mainstream-checklist/registry-tools.mjs";

const QUEUE_PATH = resolve(
  process.cwd(),
  process.env.PUBLIC_WEB_CANDIDATE_QUEUE ||
    ".checklist-discovery/public-web-aggregate/candidate-validation-queue.json",
);
const OUTPUT_PATH = resolve(
  process.cwd(),
  process.env.PUBLIC_WEB_PROMOTION_OUTPUT ||
    ".checklist-discovery/public-web-promotion-receipt.json",
);
const VALIDATED_PATH = resolve(
  process.cwd(),
  process.env.PUBLIC_WEB_VALIDATED_TARGETS_OUTPUT ||
    ".checklist-discovery/public-web-validated-targets.json",
);
const FILTER_PATH = process.env.PUBLIC_WEB_TARGET_FILTER
  ? resolve(process.cwd(), process.env.PUBLIC_WEB_TARGET_FILTER)
  : null;
const APPLY = process.env.PUBLIC_WEB_PROMOTION_APPLY === "true";
const MINIMUM_CARD_ROWS = Math.max(
  25,
  Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 25),
);
const MINING_RUN_ID = String(process.env.PUBLIC_WEB_MINING_RUN_ID || "31848415115");
const AGGREGATE_RUN_ID = String(process.env.PUBLIC_WEB_AGGREGATE_RUN_ID || "31854670094");

const REGISTRY_ARCHIVE_MIME_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "application/pdf",
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const BLOCKED_INGEST_DOMAINS = new Set([
  // Public Beckett news pages remain useful discovery leads, but their current
  // site terms do not make them an automatic commercial Registry-ingest source.
  "beckett.com",
  "www.beckett.com",
]);

const ACRONYMS = new Map([
  ["fifa", "FIFA"],
  ["mlb", "MLB"],
  ["nba", "NBA"],
  ["nfl", "NFL"],
  ["nhl", "NHL"],
  ["ufc", "UFC"],
]);

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function registrySource(downloaded) {
  if (REGISTRY_ARCHIVE_MIME_TYPES.has(downloaded.source.mimeType)) {
    return downloaded.source;
  }
  const bytes = Buffer.from(`<pre>${escapeHtml(downloaded.text)}</pre>`, "utf8");
  return {
    ...downloaded.source,
    bytes,
    mimeType: "text/html",
    filename: `${downloaded.source.filename}.normalized.html`,
    derivedNormalizedSource: true,
  };
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function directDocument(url) {
  try {
    return /\.(?:pdf|csv|tsv|xls|xlsx)(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function eligibleCandidate(candidate) {
  const domain = hostname(candidate.url || "");
  return (
    candidate?.importPolicy === "auto_import" &&
    Number(candidate?.trustScore || 0) >= 75 &&
    !BLOCKED_INGEST_DOMAINS.has(domain)
  );
}

function candidateScore(candidate) {
  let score = Number(candidate?.trustScore || 0);
  if (directDocument(candidate?.url || "")) score += 50;
  const domain = hostname(candidate?.url || "");
  if (
    domain.endsWith("topps.com") ||
    domain.endsWith("upperdeck.com") ||
    domain.endsWith("leaftradingcards.com") ||
    domain.endsWith("paniniamerica.net")
  ) {
    score += 25;
  }
  return score;
}

function displayToken(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => ACRONYMS.get(part.toLowerCase()) || `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function loadFilter() {
  if (!FILTER_PATH) return null;
  const parsed = JSON.parse(readFileSync(FILTER_PATH, "utf8"));
  const values =
    parsed.exactSetKeys ||
    parsed.validatedExactSetKeys ||
    parsed.targets ||
    [];
  const keys = Array.isArray(values)
    ? values.map((value) =>
        typeof value === "string" ? value : value?.exactSetKey,
      )
    : [];
  return new Set(keys.filter(Boolean).map((value) => String(value).toLowerCase()));
}

function buildEntry(target) {
  const parts = String(target.exactSetKey || "").split("|");
  if (parts.length !== 4) {
    throw new Error(`Invalid exactSetKey: ${target.exactSetKey}`);
  }
  const [sportKey, seasonKey, manufacturerKey, productKey] = parts;
  const candidates = (target.candidates || [])
    .filter(eligibleCandidate)
    .sort((a, b) => candidateScore(b) - candidateScore(a));
  if (!candidates.length) return null;

  const chosen = candidates[0];
  const manufacturer = displayToken(manufacturerKey);
  const product = displayToken(productKey);
  const releaseYear = Number(target.year || String(seasonKey).slice(0, 4));
  if (!Number.isInteger(releaseYear) || releaseYear < 1900 || releaseYear > 2100) {
    throw new Error(`Invalid release year for ${target.exactSetKey}`);
  }

  return {
    chosen,
    eligibleCandidates: candidates,
    entry: {
      id: `public-web-${String(target.exactSetKey).replace(/[^a-z0-9]+/gi, "-")}`,
      disposition: "import",
      sourceName: chosen.domain || hostname(chosen.url),
      sourceUrl: chosen.url,
      fallbackUrls: candidates.slice(1).map((candidate) => candidate.url),
      authority: "approved_reference_dataset",
      redistributionAllowed: false,
      minimumCardRows: MINIMUM_CARD_ROWS,
      release: {
        exactSetKey: target.exactSetKey,
        canonicalName: `${seasonKey} ${manufacturer} ${product} ${displayToken(sportKey)}`,
        manufacturer,
        brand: null,
        product,
        releaseYear,
        season: seasonKey,
        sport: sportKey,
        league: null,
      },
    },
  };
}

async function processTarget(db, target) {
  const built = buildEntry(target);
  if (!built) {
    return {
      exactSetKey: target.exactSetKey,
      status: "lead_only_unresolved",
      reason: "No non-Beckett auto-import candidate at trust >= 75.",
    };
  }

  const { entry, chosen, eligibleCandidates } = built;
  const checkedAt = new Date().toISOString();
  let downloaded = null;
  let archive = null;
  let selectedSourceUrl = entry.sourceUrl;

  const baseMetadata = {
    promotionSchema: "tcos.checklist.publicWebPromotion.v1",
    exactSetKey: target.exactSetKey,
    miningRunId: MINING_RUN_ID,
    aggregateRunId: AGGREGATE_RUN_ID,
    sourceArtifact: target.sourceArtifact || null,
    discoveryShard: target.shard ?? null,
    candidateTrustScore: Number(chosen.trustScore || 0),
    candidateImportPolicy: chosen.importPolicy || null,
    candidateCount: Number(target.exactCandidateCount || 0),
    trustedCandidateCount: Number(target.trustedAutoImportCandidateCount || 0),
    eligibleCommercialIngestCandidates: eligibleCandidates.length,
  };

  try {
    downloaded = await downloadAndParse(entry);
    selectedSourceUrl = String(
      downloaded.source.selectedUrl ||
        downloaded.source.finalUrl ||
        entry.sourceUrl,
    );
    archive = await uploadArchive(db, downloaded.source);
    if (downloaded.landingPage) await uploadArchive(db, downloaded.landingPage);

    const registryArtifact = registrySource(downloaded);
    const plan = buildPlan(entry, downloaded.parsed, registryArtifact, checkedAt);
    const complexity = assertPlanComplexity(plan);
    const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
    const common = {
      manufacturer: plan.release.manufacturer,
      sport: plan.release.sport,
      source_url: selectedSourceUrl,
      source_sha256: archive.digest,
      release_slug: plan.release.releaseSlug,
      release_name: entry.release.canonicalName,
      adapter_id: plan.adapterId,
      adapter_version: plan.adapterVersion,
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      validation_counts: plan.validation.counts,
      issue_summary: limitedIssues(plan.validation.issues),
      metadata: {
        ...baseMetadata,
        rawArchived: true,
        archiveBucket: ARCHIVE_BUCKET,
        archiveObjectPath: archive.objectPath,
        selectedUrl: selectedSourceUrl,
        finalUrl: downloaded.source.finalUrl,
        sourceMimeType: downloaded.source.mimeType,
        sourceSizeBytes: downloaded.source.bytes.byteLength,
        registrySourceMimeType: registryArtifact.mimeType,
        registrySourceDerived: registryArtifact.derivedNormalizedSource === true,
        extractedTextBytes: Buffer.byteLength(downloaded.text, "utf8"),
        planBytes: complexity.serializedBytes,
      },
    };

    if (errors.length || plan.validation.status !== "passed") {
      await upsertCatalog(db, { ...common, status: "quarantined" });
      return {
        exactSetKey: target.exactSetKey,
        status: "quarantined",
        sourceUrl: selectedSourceUrl,
        counts: plan.validation.counts,
        errors: limitedIssues(errors),
      };
    }

    if (!APPLY) {
      await upsertCatalog(db, { ...common, status: "validated" });
      return {
        exactSetKey: target.exactSetKey,
        status: "validated",
        sourceUrl: selectedSourceUrl,
        counts: plan.validation.counts,
      };
    }

    const persistence = await persistPlan(db, plan, registryArtifact.bytes);
    await upsertCatalog(db, {
      ...common,
      status: "imported",
      imported_at: checkedAt,
    });
    return {
      exactSetKey: target.exactSetKey,
      status: "imported",
      sourceUrl: selectedSourceUrl,
      counts: plan.validation.counts,
      persistence,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const status = archive ? "quarantined" : "failed";
    try {
      await upsertCatalog(db, {
        manufacturer: entry.release.manufacturer,
        sport: entry.release.sport,
        source_url: selectedSourceUrl,
        source_sha256: archive?.digest || null,
        release_name: entry.release.canonicalName,
        status,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        issue_summary: [
          {
            code: archive
              ? "public_web_candidate_normalization_quarantined"
              : "public_web_candidate_ingest_failure",
            severity: "error",
            message: message.slice(0, 500),
          },
        ],
        metadata: {
          ...baseMetadata,
          rawArchived: Boolean(archive),
          archiveBucket: archive ? ARCHIVE_BUCKET : null,
          archiveObjectPath: archive?.objectPath || null,
          selectedUrl: selectedSourceUrl,
        },
      });
    } catch (catalogError) {
      console.error(
        `Catalog write also failed for ${target.exactSetKey}: ${
          catalogError instanceof Error ? catalogError.message : String(catalogError)
        }`,
      );
    }
    return {
      exactSetKey: target.exactSetKey,
      status,
      sourceUrl: selectedSourceUrl,
      message,
    };
  }
}

async function main() {
  const queue = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  if (
    queue.schema !== "tcos.checklist.mainstream2005plusCandidateValidationQueue.v1" ||
    !Array.isArray(queue.targets) ||
    queue.count !== queue.targets.length
  ) {
    throw new Error("Candidate validation queue failed schema/count validation.");
  }

  const filter = loadFilter();
  const selectedTargets = queue.targets.filter((target) =>
    filter ? filter.has(String(target.exactSetKey).toLowerCase()) : true,
  );

  const db = dbClient();
  await ensureArchiveBucket(db);

  const startedAt = new Date().toISOString();
  const results = [];
  // Registry writes are intentionally serialized. Prior recovery runs proved that
  // parallel authoritative writers create avoidable lock/transaction timeouts.
  for (const target of selectedTargets) {
    console.log(
      `[public-web-promotion] ${APPLY ? "apply" : "validate"} ${target.exactSetKey}`,
    );
    results.push(await processTarget(db, target));
  }

  const statuses = {};
  const normalizedTotals = { sets: 0, cards: 0, parallels: 0, identities: 0 };
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    for (const key of Object.keys(normalizedTotals)) {
      normalizedTotals[key] += Number(result.counts?.[key] || 0);
    }
  }

  const validatedExactSetKeys = results
    .filter((result) => ["validated", "imported"].includes(result.status))
    .map((result) => result.exactSetKey);

  const receipt = {
    schema: "tcos.checklist.mainstream2005plusPublicWebPromotionReceipt.v1",
    mode: APPLY ? "apply" : "validate",
    startedAt,
    completedAt: new Date().toISOString(),
    miningRunId: MINING_RUN_ID,
    aggregateRunId: AGGREGATE_RUN_ID,
    queueCount: queue.targets.length,
    selectedCount: selectedTargets.length,
    minimumCardRows: MINIMUM_CARD_ROWS,
    blockedAutomaticIngestDomains: [...BLOCKED_INGEST_DOMAINS],
    registryWriter: "serialized",
    statuses,
    normalizedTotals,
    validatedExactSetKeys,
    results,
  };

  writeJson(OUTPUT_PATH, receipt);
  writeJson(VALIDATED_PATH, {
    schema: "tcos.checklist.mainstream2005plusValidatedTargets.v1",
    mode: receipt.mode,
    miningRunId: MINING_RUN_ID,
    aggregateRunId: AGGREGATE_RUN_ID,
    count: validatedExactSetKeys.length,
    exactSetKeys: validatedExactSetKeys,
  });

  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
