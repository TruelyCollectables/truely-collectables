import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCE_RUN_ID = String(process.env.CHECKLIST_ARCHIVE_SOURCE_RUN_ID || "31100986894");
const SOURCE_ARTIFACT_ID = String(process.env.CHECKLIST_ARCHIVE_SOURCE_ARTIFACT_ID || "8972198573");
const MASTER_ROOT = resolve(process.cwd(), process.env.CHECKLIST_ARCHIVE_MASTER_ROOT || ".card-checklist-master-archive");
const SCAN_ROOTS = String(
  process.env.CHECKLIST_ARCHIVE_SCAN_ROOTS ||
    ".card-checklist-master-archive,.public-checklist-source-archive,.internal-checklist-source-archive",
)
  .split(",")
  .map((value) => resolve(process.cwd(), value.trim()))
  .filter(Boolean);
const OUTPUT = resolve(
  process.cwd(),
  process.env.CHECKLIST_ARCHIVE_RECEIPT ||
    `.checklist-archive-ingest/receipt-${SOURCE_RUN_ID}-${SOURCE_ARTIFACT_ID}.json`,
);
const BUCKET = "tcos-checklist-universal-archive";
const BATCH_KEY = `${SOURCE_RUN_ID}-${SOURCE_ARTIFACT_ID}`;
const BATCH_PREFIX = `batches/${BATCH_KEY}`;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const HASH_WORKERS = Math.max(1, Math.min(12, Number(process.env.CHECKLIST_ARCHIVE_HASH_WORKERS || 8)));
const UPLOAD_WORKERS = Math.max(1, Math.min(10, Number(process.env.CHECKLIST_ARCHIVE_UPLOAD_WORKERS || 6)));
const REQUIRED_TOTALS = {
  sourceItems: 10275,
  exactMasterSets: 6259,
  uniqueStoredFileHashes: 12095,
};
const ALLOWED_MIME_TYPES = [
  "application/json",
  "text/plain",
  "text/csv",
  "text/html",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
];

function requireEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Universal checklist ingestion requires Supabase service-role access.");
  }
  return { url, key };
}

function client() {
  const { url, key } = requireEnvironment();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function mimeType(path) {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".pdf":
      return "application/pdf";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function safeRelative(path) {
  const value = relative(process.cwd(), path).split(sep).join("/");
  if (!value || value === ".." || value.startsWith("../") || value.includes("/../")) {
    throw new Error(`Archive path escaped the repository root: ${path}`);
  }
  return value;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const output = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        throw new Error(`Symbolic links are forbidden in the archive: ${safeRelative(path)}`);
      }
      if (info.isDirectory()) queue.push(path);
      else if (info.isFile()) output.push(path);
    }
  }
  return output.sort();
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function parallelMap(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function storagePath(sha256) {
  return `blobs/${sha256.slice(0, 2)}/${sha256}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensurePrivateBucket(db) {
  const options = {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  };
  const { data, error } = await db.storage.getBucket(BUCKET);
  if (error || !data) {
    const created = await db.storage.createBucket(BUCKET, options);
    if (created.error && !/already exists|duplicate|409/i.test(created.error.message || "")) {
      throw new Error(`Could not create private universal checklist bucket: ${created.error.message}`);
    }
  } else {
    if (data.public) throw new Error(`${BUCKET} exists but is public.`);
    const updated = await db.storage.updateBucket(BUCKET, options);
    if (updated.error) {
      throw new Error(`Could not enforce private universal checklist bucket settings: ${updated.error.message}`);
    }
  }
  const verified = await db.storage.getBucket(BUCKET);
  if (verified.error || !verified.data || verified.data.public) {
    throw new Error("Universal checklist archive bucket did not verify as private.");
  }
  return verified.data;
}

async function existingBlobNames(db) {
  const names = new Set();
  const hex = "0123456789abcdef";
  for (const first of hex) {
    for (const second of hex) {
      const prefix = `blobs/${first}${second}`;
      let offset = 0;
      while (true) {
        const { data, error } = await db.storage.from(BUCKET).list(prefix, {
          limit: 1000,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) throw new Error(`Could not list ${prefix}: ${error.message}`);
        for (const row of data || []) {
          if (/^[a-f0-9]{64}$/.test(row.name)) names.add(row.name);
        }
        if (!data || data.length < 1000) break;
        offset += data.length;
      }
    }
  }
  return names;
}

async function uploadJson(db, objectPath, value) {
  const bytes = jsonBytes(value);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`Generated index ${objectPath} exceeds the 50 MiB archive limit.`);
  }
  const { error } = await db.storage.from(BUCKET).upload(objectPath, bytes, {
    contentType: "application/json",
    cacheControl: "0",
    upsert: true,
  });
  if (error) throw new Error(`Could not upload ${objectPath}: ${error.message}`);
  return { objectPath, bytes: bytes.byteLength };
}

function chooseCatalogItem(items) {
  return [...items].sort((left, right) => {
    const leftScore =
      (left.classificationStatus === "sorted" ? 1_000_000 : 0) +
      Number(left.checklistRows || 0);
    const rightScore =
      (right.classificationStatus === "sorted" ? 1_000_000 : 0) +
      Number(right.checklistRows || 0);
    return rightScore - leftScore;
  })[0];
}

async function readExistingCatalogStatuses(db, urls) {
  const existing = new Map();
  for (const group of chunks(urls, 100)) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("source_url,status")
      .in("source_url", group);
    if (error) throw new Error(`Could not read source catalog: ${error.message}`);
    for (const row of data || []) existing.set(row.source_url, row.status);
  }
  return existing;
}

async function upsertArchiveCatalog(db, sourceItems, completedAt) {
  const grouped = new Map();
  for (const item of sourceItems) {
    const sourceUrl = String(item.sourceUrl || "").trim();
    if (!sourceUrl) continue;
    const list = grouped.get(sourceUrl) || [];
    list.push(item);
    grouped.set(sourceUrl, list);
  }

  const urls = [...grouped.keys()];
  const existing = await readExistingCatalogStatuses(db, urls);
  const protectedStatuses = new Set(["imported", "validated", "unchanged"]);
  const rows = [];
  let protectedRows = 0;

  for (const [sourceUrl, items] of grouped) {
    if (protectedStatuses.has(existing.get(sourceUrl))) {
      protectedRows += 1;
      continue;
    }
    const item = chooseCatalogItem(items);
    const primaryFile = (item.files || []).find((file) => file.role === "source-download") ||
      (item.files || []).find((file) => file.role === "checklist-text") ||
      (item.files || []).find((file) => file.role !== "metadata") ||
      (item.files || [])[0] || null;
    const unresolved = item.classificationStatus !== "sorted";
    const noRows = Number(item.checklistRows || 0) < 1;
    const code = unresolved
      ? "universal_archive_exact_set_unresolved"
      : noRows
        ? "universal_archive_set_index_only"
        : "universal_archive_normalization_pending";
    const message = unresolved
      ? `Archived source is missing exact set fields: ${(item.missing || []).join(", ") || "unknown"}.`
      : noRows
        ? "Archived source identifies a set but contains no normalized checklist rows."
        : "Archived checklist evidence is permanent but requires deterministic normalization before active Registry promotion.";
    const refs = items.slice(0, 25).map((value) => ({
      id: value.id,
      source: value.source,
      archivePath: value.archivePath,
      exactSetKey: value.exactSetKey,
      checklistRows: Number(value.checklistRows || 0),
      classificationStatus: value.classificationStatus,
    }));
    rows.push({
      manufacturer: item.manufacturer || "Unresolved",
      sport: item.sport || null,
      source_url: sourceUrl,
      source_sha256: primaryFile?.sha256 || null,
      release_slug: item.exactSetKey ? String(item.exactSetKey).replaceAll("|", "-") : null,
      release_name: [item.season, item.manufacturer, item.product].filter(Boolean).join(" ") || item.title || null,
      adapter_id: null,
      adapter_version: null,
      status: "quarantined",
      last_seen_at: completedAt,
      last_checked_at: completedAt,
      validation_counts: { sets: 0, cards: 0, parallels: 0, identities: 0 },
      issue_summary: [{ code, severity: "error", message }],
      metadata: {
        archiveSchema: "tcos.universalChecklistPermanentArchive.v1",
        archiveSourceRunId: SOURCE_RUN_ID,
        archiveSourceArtifactId: SOURCE_ARTIFACT_ID,
        archiveBucket: BUCKET,
        archiveBatchPrefix: BATCH_PREFIX,
        sourceItemCount: items.length,
        sourceItems: refs,
        reportedChecklistRowsMaximum: Math.max(...items.map((value) => Number(value.checklistRows || 0))),
        originalClassificationStatus: item.classificationStatus,
        originalSource: item.source,
        originalTitle: item.title,
        originalFiles: item.files || [],
      },
    });
  }

  for (const group of chunks(rows, 200)) {
    const { error } = await db
      .from("checklist_source_catalog")
      .upsert(group, { onConflict: "source_url" });
    if (error) throw new Error(`Could not register archived checklist sources: ${error.message}`);
  }

  return {
    uniqueSourceUrls: urls.length,
    catalogRowsUpserted: rows.length,
    protectedLiveCatalogRows: protectedRows,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const db = client();
  const manifestPath = resolve(MASTER_ROOT, "manifest.json");
  const sourceItemsPath = resolve(MASTER_ROOT, "source-items.json");
  const masterSetsPath = resolve(MASTER_ROOT, "master-sets.json");
  for (const path of [manifestPath, sourceItemsPath, masterSetsPath]) {
    if (!existsSync(path)) throw new Error(`Required master archive file is missing: ${safeRelative(path)}`);
  }

  const manifest = readJson(manifestPath);
  const sourceItems = readJson(sourceItemsPath);
  const masterSets = readJson(masterSetsPath);
  if (manifest.schema !== "tcos.universalCardChecklistArchive.v2") {
    throw new Error(`Unsupported universal archive schema: ${manifest.schema}`);
  }
  for (const [key, expected] of Object.entries(REQUIRED_TOTALS)) {
    if (Number(manifest.totals?.[key]) !== expected) {
      throw new Error(`Master archive ${key} changed: expected ${expected}, found ${manifest.totals?.[key]}.`);
    }
  }
  if (sourceItems.length !== REQUIRED_TOTALS.sourceItems || masterSets.length !== REQUIRED_TOTALS.exactMasterSets) {
    throw new Error("Master archive indexes do not reconcile with the verified manifest totals.");
  }

  const bucket = await ensurePrivateBucket(db);
  const roots = SCAN_ROOTS.filter(existsSync);
  if (!roots.length) throw new Error("No extracted universal checklist archive roots were found.");
  const allPaths = [...new Set(roots.flatMap(walkFiles))].sort();
  if (!allPaths.length) throw new Error("The extracted universal checklist archive contains no files.");

  console.log(JSON.stringify({ phase: "hashing", files: allPaths.length, workers: HASH_WORKERS }));
  const pathEntries = await parallelMap(allPaths, HASH_WORKERS, async (path) => {
    const info = statSync(path);
    if (info.size < 1 || info.size > MAX_FILE_BYTES) {
      throw new Error(`Archive file size is invalid (${info.size} bytes): ${safeRelative(path)}`);
    }
    const sha256 = await sha256File(path);
    return {
      relativePath: safeRelative(path),
      sha256,
      bytes: info.size,
      mimeType: mimeType(path),
      originalFilename: basename(path),
      absolutePath: path,
    };
  });

  const blobs = new Map();
  for (const entry of pathEntries) {
    const prior = blobs.get(entry.sha256);
    if (prior && prior.bytes !== entry.bytes) {
      throw new Error(`SHA-256 collision or size mismatch for ${entry.sha256}.`);
    }
    if (!prior) blobs.set(entry.sha256, entry);
  }
  if (blobs.size < REQUIRED_TOTALS.uniqueStoredFileHashes) {
    throw new Error(
      `Extracted archive contains only ${blobs.size} unique blobs; expected at least ${REQUIRED_TOTALS.uniqueStoredFileHashes}.`,
    );
  }

  const existing = await existingBlobNames(db);
  const missing = [...blobs.values()].filter((entry) => !existing.has(entry.sha256));
  let uploadedBlobs = 0;
  let duplicateBlobs = blobs.size - missing.length;
  let uploadedBytes = 0;

  console.log(JSON.stringify({ phase: "uploading", uniqueBlobs: blobs.size, missingBlobs: missing.length, workers: UPLOAD_WORKERS }));
  await parallelMap(missing, UPLOAD_WORKERS, async (entry, index) => {
    const bytes = readFileSync(entry.absolutePath);
    const { error } = await db.storage.from(BUCKET).upload(storagePath(entry.sha256), bytes, {
      contentType: entry.mimeType,
      cacheControl: "0",
      upsert: false,
    });
    if (error) {
      if (/already exists|duplicate|409/i.test(error.message || "")) {
        duplicateBlobs += 1;
      } else {
        throw new Error(`Could not archive ${entry.relativePath}: ${error.message}`);
      }
    } else {
      uploadedBlobs += 1;
      uploadedBytes += entry.bytes;
    }
    if ((index + 1) % 250 === 0) {
      console.log(JSON.stringify({ phase: "uploading", processed: index + 1, missingBlobs: missing.length, uploadedBlobs }));
    }
  });

  const completedAt = new Date().toISOString();
  const pathIndex = {
    schema: "tcos.universalChecklistArchivePathIndex.v1",
    sourceRunId: SOURCE_RUN_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID,
    generatedAt: completedAt,
    bucket: BUCKET,
    objectPathRule: "blobs/<sha256-prefix>/<sha256>",
    paths: pathEntries.map(({ absolutePath: _absolutePath, ...entry }) => ({
      ...entry,
      storageObjectPath: storagePath(entry.sha256),
    })),
  };
  const blobIndex = {
    schema: "tcos.universalChecklistArchiveBlobIndex.v1",
    sourceRunId: SOURCE_RUN_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID,
    generatedAt: completedAt,
    bucket: BUCKET,
    blobs: [...blobs.values()].map((entry) => ({
      sha256: entry.sha256,
      bytes: entry.bytes,
      mimeType: entry.mimeType,
      storageObjectPath: storagePath(entry.sha256),
      representativePath: entry.relativePath,
    })),
  };
  const batchManifest = {
    schema: "tcos.universalChecklistPermanentArchive.v1",
    status: "passed",
    sourceRunId: SOURCE_RUN_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID,
    startedAt,
    completedAt,
    privateStorage: true,
    bucket: BUCKET,
    bucketPublic: Boolean(bucket.public),
    sourceManifest: manifest,
    totals: {
      extractedPaths: pathEntries.length,
      uniqueBlobs: blobs.size,
      uploadedBlobs,
      previouslyArchivedBlobs: duplicateBlobs,
      uploadedBytes,
      sourceItems: sourceItems.length,
      exactMasterSets: masterSets.length,
      exactSetsWithChecklistRows: masterSets.filter((row) => Number(row.checklistRowsMaximum || 0) > 0).length,
      unresolvedSourceItems: sourceItems.filter((row) => row.classificationStatus === "unresolved").length,
    },
  };

  const indexUploads = [];
  indexUploads.push(await uploadJson(db, `${BATCH_PREFIX}/manifest.json`, batchManifest));
  indexUploads.push(await uploadJson(db, `${BATCH_PREFIX}/path-index.json`, pathIndex));
  indexUploads.push(await uploadJson(db, `${BATCH_PREFIX}/blob-index.json`, blobIndex));
  indexUploads.push(await uploadJson(db, `${BATCH_PREFIX}/master-sets.json`, masterSets));
  indexUploads.push(await uploadJson(db, `${BATCH_PREFIX}/source-items.json`, sourceItems));

  const catalog = await upsertArchiveCatalog(db, sourceItems, completedAt);
  const receipt = {
    ...batchManifest,
    indexUploads,
    catalog,
    activationPolicy: {
      rawArchiveIsPermanent: true,
      rawRowsAutomaticallyActivated: false,
      reason:
        "Public-reference captures must pass deterministic source-specific normalization and validation before they can replace or create an active Checklist Registry version.",
    },
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await uploadJson(db, `${BATCH_PREFIX}/receipt.json`, receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  try {
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(
      OUTPUT,
      `${JSON.stringify({
        schema: "tcos.universalChecklistPermanentArchive.v1",
        status: "failed",
        sourceRunId: SOURCE_RUN_ID,
        sourceArtifactId: SOURCE_ARTIFACT_ID,
        failedAt: new Date().toISOString(),
        error: message.slice(0, 2000),
      }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Keep the primary error.
  }
  process.exitCode = 1;
});
