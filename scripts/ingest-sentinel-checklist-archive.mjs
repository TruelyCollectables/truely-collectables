import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseSourceBytes } from "./master-checklist-archive/archive-source-tools.mjs";
import { normalized, parseChecklist, sha256 } from "./mainstream-checklist/source-tools.mjs";
import {
  assertPlanComplexity,
  buildPlan,
  dbClient,
  limitedIssues,
  persistPlan,
  upsertCatalog,
} from "./mainstream-checklist/registry-tools.mjs";

const SENTINEL_BUCKET = "instacomp-checklist-sentinel";
const OUTPUT = resolve(process.cwd(), process.env.SENTINEL_REGISTRY_OUTPUT || ".checklist-discovery/sentinel-registry-drain.json");
const APPLY = process.env.SENTINEL_REGISTRY_APPLY !== "false";
const WORKERS = Math.max(1, Math.min(4, Number(process.env.SENTINEL_REGISTRY_WORKERS || 2)));
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/sentinel-registry-tmp");

function writeReceipt(value) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(value, null, 2));
}

function stripHtml(value) {
  let html = String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  html = html.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (whole, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => normalized(match[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")))
      .filter(Boolean);
    return cells.length ? `\n${cells.join(" | ")}\n` : "\n";
  });
  return html
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (whole, body) => `\n## ${normalized(body.replace(/<[^>]+>/g, " "))}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|div|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .split(/\r?\n/)
    .map(normalized)
    .filter(Boolean)
    .join("\n");
}

function pdfText(bytes) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const path = resolve(TEMP_ROOT, `${sha256(bytes).slice(0, 16)}.pdf`);
  writeFileSync(path, bytes);
  try {
    return execFileSync("pdftotext", ["-layout", "-nopgbrk", path, "-"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 240_000,
    }).trim();
  } finally {
    rmSync(path, { force: true });
  }
}

function parseBytes(entry, source) {
  const mime = String(source.mimeType || "application/octet-stream").toLowerCase();
  if (mime.includes("pdf")) {
    const text = pdfText(source.bytes);
    return { text, parsed: parseChecklist(entry, text) };
  }
  if (mime.includes("html") || mime.includes("xhtml")) {
    const text = stripHtml(Buffer.from(source.bytes).toString("utf8"));
    return { text, parsed: parseChecklist(entry, text) };
  }
  return parseSourceBytes(entry, source);
}

async function listAll(storage, path) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(path, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Could not list ${path}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function loadPendingReceipts(db) {
  const storage = db.storage.from(SENTINEL_BUCKET);
  const prefixes = await listAll(storage, "receipts");
  const receipts = [];
  for (const prefix of prefixes) {
    if (!prefix?.name) continue;
    const children = await listAll(storage, `receipts/${prefix.name}`);
    for (const child of children) {
      if (!child?.name?.endsWith(".json")) continue;
      const path = `receipts/${prefix.name}/${child.name}`;
      const { data, error } = await storage.download(path);
      if (error || !data) continue;
      try {
        const receipt = JSON.parse(Buffer.from(await data.arrayBuffer()).toString("utf8"));
        if (receipt?.archiveStatus === "private_source_archived_pending_registry_validation") receipts.push(receipt);
      } catch {
        // Invalid immutable receipts remain visible to the archive audit but cannot be promoted.
      }
    }
  }
  const bySha = new Map();
  for (const receipt of receipts) {
    const key = receipt.sha256 || receipt.storagePath || receipt.sourceUrl;
    if (!bySha.has(key)) bySha.set(key, receipt);
  }
  return [...bySha.values()];
}

function entryFor(receipt) {
  const season = String(receipt.season || receipt.year || "").trim();
  const releaseYear = String(receipt.year || season.match(/\b(?:19|20)\d{2}\b/)?.[0] || "").trim() || null;
  return {
    id: `SENTINEL-${String(receipt.sha256 || "").slice(0, 12)}`,
    disposition: "standalone",
    sourceName: receipt.source || "instacomp-ai-checklist-sentinel",
    sourceUrl: receipt.finalSourceUrl || receipt.sourceUrl,
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: 3,
    release: {
      canonicalName: [season, receipt.manufacturer, receipt.product, receipt.sport].filter(Boolean).join(" "),
      exactSetKey: receipt.targetKey || null,
      manufacturer: String(receipt.manufacturer || "").trim(),
      brand: null,
      product: String(receipt.product || "").trim(),
      releaseYear,
      season: season || releaseYear,
      sport: String(receipt.sport || "").trim(),
      league: null,
    },
  };
}

function receiptValid(receipt, entry) {
  return Boolean(
    receipt?.storagePath &&
    /^[a-f0-9]{64}$/i.test(String(receipt.sha256 || "")) &&
    entry.release.manufacturer &&
    entry.release.product &&
    entry.release.season &&
    entry.release.sport &&
    entry.sourceUrl
  );
}

async function processReceipt(db, receipt) {
  const entry = entryFor(receipt);
  if (!receiptValid(receipt, entry)) {
    return { sha256: receipt.sha256 || null, targetKey: receipt.targetKey || null, status: "unresolved_metadata" };
  }

  const storage = db.storage.from(SENTINEL_BUCKET);
  const { data, error } = await storage.download(receipt.storagePath);
  if (error || !data) {
    return { sha256: receipt.sha256, targetKey: receipt.targetKey, status: "source_missing", message: error?.message || "Archived source could not be downloaded." };
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (sha256(bytes) !== String(receipt.sha256).toLowerCase()) {
    return { sha256: receipt.sha256, targetKey: receipt.targetKey, status: "sha_mismatch" };
  }
  const source = {
    bytes,
    mimeType: String(receipt.contentType || "application/octet-stream"),
    filename: String(receipt.originalFileName || `${receipt.sha256}.source`),
    selectedUrl: entry.sourceUrl,
    finalUrl: receipt.finalSourceUrl || entry.sourceUrl,
    sentinelArchiveSource: true,
  };

  try {
    const { parsed } = parseBytes(entry, source);
    const errors = parsed.errors?.filter((issue) => issue.severity === "error") || [];
    if (parsed.cards.length < 3 || errors.length) {
      await upsertCatalog(db, {
        manufacturer: entry.release.manufacturer,
        sport: entry.release.sport,
        source_url: entry.sourceUrl,
        source_sha256: receipt.sha256,
        release_name: entry.release.canonicalName,
        status: "quarantined",
        last_seen_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        validation_counts: { sets: 0, cards: parsed.cards.length, parallels: parsed.parallels.length, identities: 0 },
        issue_summary: limitedIssues(errors.length ? errors : [{ code: "sentinel_insufficient_rows", severity: "error", message: `Only ${parsed.cards.length} deterministic rows were parsed.` }]),
        metadata: { sentinelReceipt: receipt.receipt, sentinelStorageBucket: SENTINEL_BUCKET, sentinelStoragePath: receipt.storagePath, sentinelArchiveStatus: receipt.archiveStatus },
      });
      return { sha256: receipt.sha256, targetKey: receipt.targetKey, status: "quarantined", cards: parsed.cards.length };
    }

    parsed.warnings = [...(parsed.warnings || []), { code: "sentinel_archived_source", severity: "warning", message: "Source originated in the private Checklist Sentinel archive." }];
    const plan = buildPlan(entry, parsed, source, receipt.archivedAt || new Date().toISOString());
    assertPlanComplexity(plan);
    const planErrors = plan.validation.issues.filter((issue) => issue.severity === "error");
    if (planErrors.length) throw new Error(planErrors.slice(0, 3).map((issue) => issue.message).join("; "));
    const checkedAt = new Date().toISOString();
    const common = {
      manufacturer: entry.release.manufacturer,
      sport: entry.release.sport,
      source_url: entry.sourceUrl,
      source_sha256: receipt.sha256,
      release_slug: plan.release.releaseSlug,
      release_name: entry.release.canonicalName,
      adapter_id: plan.adapterId,
      adapter_version: plan.adapterVersion,
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      validation_counts: plan.validation.counts,
      issue_summary: limitedIssues(plan.validation.issues),
      metadata: {
        sentinelReceipt: receipt.receipt,
        sentinelStorageBucket: SENTINEL_BUCKET,
        sentinelStoragePath: receipt.storagePath,
        sentinelArchiveStatus: receipt.archiveStatus,
        sentinelTargetKey: receipt.targetKey,
        sentinelSourceSha256: receipt.sha256,
      },
    };
    if (!APPLY) {
      await upsertCatalog(db, { ...common, status: "validated" });
      return { sha256: receipt.sha256, targetKey: receipt.targetKey, status: "validated", counts: plan.validation.counts };
    }
    const persistence = await persistPlan(db, plan, bytes);
    await upsertCatalog(db, { ...common, status: "imported", imported_at: checkedAt });
    return { sha256: receipt.sha256, targetKey: receipt.targetKey, status: "imported", counts: plan.validation.counts, persistence };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await upsertCatalog(db, {
      manufacturer: entry.release.manufacturer,
      sport: entry.release.sport,
      source_url: entry.sourceUrl,
      source_sha256: receipt.sha256,
      release_name: entry.release.canonicalName,
      status: "quarantined",
      last_seen_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      issue_summary: [{ code: "sentinel_registry_promotion_failed", severity: "error", message: message.slice(0, 500) }],
      metadata: { sentinelReceipt: receipt.receipt, sentinelStorageBucket: SENTINEL_BUCKET, sentinelStoragePath: receipt.storagePath, sentinelArchiveStatus: receipt.archiveStatus },
    });
    return { sha256: receipt.sha256, targetKey: receipt.targetKey, status: "quarantined", message };
  }
}

async function parallelMap(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  }));
  return output;
}

async function main() {
  const db = dbClient();
  const startedAt = new Date().toISOString();
  const receipts = await loadPendingReceipts(db);
  const results = await parallelMap(receipts, WORKERS, (receipt) => processReceipt(db, receipt));
  const statuses = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] || 0) + 1;
  writeReceipt({
    schema: "tcos.checklist.sentinelRegistryDrain.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    pendingReceiptsFound: receipts.length,
    mode: APPLY ? "apply" : "validate",
    statuses,
    results,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
