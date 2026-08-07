import { createHash } from "node:crypto";

export const ARCHIVE_BUCKET = "instacomp-checklist-source-archive";
export const ARCHIVE_PREFIX = "mainstream-2000-plus";
export const CHECKLIST_SOURCE_BUCKET = "instacomp-checklist-sources";
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalized(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sourceKey(prefix, values) {
  return `${prefix}-${sha256(values.join("\u0001")).slice(0, 24)}`;
}

function normalizeName(value) {
  return normalized(value).toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
}

function normalizeCardNumber(value) {
  return normalized(value).toLowerCase().replace(/[^a-z0-9/]+/g, "");
}

function inferSetType(name) {
  const value = normalized(name).toLowerCase();
  if (!value || /^(base|base set|base cards)$/.test(value)) return "base";
  if (/autograph|signature|signed/.test(value)) return "autograph";
  if (/relic|memorabilia|patch|swatch|jersey/.test(value)) return "memorabilia";
  if (/insert|subset|rookie|prospect|variation|short print|sp\b/.test(value)) return "insert";
  return "other";
}

export function buildImportPlan(entry, source, archive, parsed, { sourceUrl = null } = {}) {
  const release = entry.release || {};
  const canonicalName = normalized(release.canonicalName || `${release.releaseYear || release.season || ""} ${release.product || ""}`);
  const releaseSlug = slug(canonicalName);
  const setNames = [...new Set(parsed.cards.map((card) => normalized(card.setName || "Base Set")))];
  const sets = setNames.map((name) => ({
    sourceKey: sourceKey("set", [canonicalName, name]),
    name,
    normalizedName: normalizeName(name),
    setType: inferSetType(name),
  }));
  const setKeyByName = new Map(sets.map((set) => [set.name, set.sourceKey]));

  const cards = parsed.cards.map((card) => {
    const players = [...new Set((card.players || []).map(normalized).filter(Boolean))];
    const teams = [...new Set((card.teams || []).map(normalized).filter(Boolean))];
    const setName = normalized(card.setName || "Base Set");
    const cardNumber = normalized(card.cardNumber);
    const variation = card.variation ? normalized(card.variation) : null;
    const sourceKeyValue = sourceKey("card", [
      canonicalName,
      setName,
      cardNumber,
      players.join("+"),
      teams.join("+"),
      variation || "",
    ]);
    return {
      sourceKey: sourceKeyValue,
      setSourceKey: setKeyByName.get(setName),
      cardNumber,
      players,
      teams,
      rookieDesignation: card.rookieDesignation ?? null,
      firstBowmanDesignation: card.firstBowmanDesignation ?? null,
      autographStatus: card.autographStatus || "non-auto",
      memorabiliaStatus: card.memorabiliaStatus || "non-memorabilia",
      variation,
      sourceNotes: card.sourceNotes || null,
    };
  });

  const parallelRows = parsed.parallels || [];
  const parallels = parallelRows.map((parallel) => {
    const setName = normalized(parallel.setName || "Base Set");
    const name = normalized(parallel.name);
    return {
      sourceKey: sourceKey("parallel", [canonicalName, setName, name, parallel.serialRun || ""]),
      setSourceKey: setKeyByName.get(setName) || setKeyByName.get("Base Set") || sets[0]?.sourceKey,
      name,
      serialRun: parallel.serialRun ?? null,
      configurationExclusivity: parallel.configurationExclusivity || null,
      appliesToAllCards: Boolean(parallel.appliesToAllCards),
    };
  });

  const parallelKeyBySetAndName = new Map(
    parallels.map((parallel) => [
      `${parallel.setSourceKey}\u0001${normalizeName(parallel.name)}`,
      parallel.sourceKey,
    ]),
  );

  const identities = [];
  for (const card of cards) {
    const set = sets.find((row) => row.sourceKey === card.setSourceKey);
    const related = parallels.filter(
      (parallel) => parallel.setSourceKey === card.setSourceKey && parallel.appliesToAllCards,
    );
    const choices = [null, ...related];
    for (const parallel of choices) {
      const fingerprint = {
        schema: "tcos.checklist.identity.v1",
        normalized: {
          release: canonicalName.toLowerCase(),
          set: set?.normalizedName || "base set",
          cardNumber: normalizeCardNumber(card.cardNumber),
          players: [...card.players].map(normalizeName).sort(),
          teams: [...card.teams].map(normalizeName).sort(),
          parallel: parallel ? normalizeName(parallel.name) : null,
          serialRun: parallel?.serialRun ? String(parallel.serialRun) : null,
          autographStatus: card.autographStatus,
          memorabiliaStatus: card.memorabiliaStatus,
          variation: card.variation ? normalizeName(card.variation) : null,
          configurationExclusivity: parallel?.configurationExclusivity || null,
        },
      };
      const canonicalKey = JSON.stringify(fingerprint.normalized);
      fingerprint.canonicalKey = canonicalKey;
      fingerprint.fingerprintSha256 = sha256(`${fingerprint.schema}\u0000${canonicalKey}`);
      identities.push({
        cardSourceKey: card.sourceKey,
        parallelSourceKey: parallel
          ? parallelKeyBySetAndName.get(`${parallel.setSourceKey}\u0001${normalizeName(parallel.name)}`)
          : null,
        fingerprint,
      });
    }
  }

  const issues = [...parsed.warnings, ...parsed.errors];
  const errors = issues.filter((issue) => issue.severity === "error");
  const selectedSourceUrl = sourceUrl || source.selectedUrl || entry.sourceUrl;
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: "mainstream-backlog-v1",
    adapterVersion: "2026.08.07.2",
    release: {
      manufacturer: release.manufacturer,
      brand: release.brand || release.manufacturer,
      sport: release.sport,
      league: release.league || null,
      product: release.product,
      releaseYear: release.releaseYear || null,
      season: release.season || null,
      canonicalName,
      releaseSlug,
    },
    source: {
      sourceUrl: selectedSourceUrl,
      authority: entry.authority || "reference_source",
      retrievedAt: new Date().toISOString(),
      redistributionAllowed: false,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage: {
        bucket: CHECKLIST_SOURCE_BUCKET,
        objectPath: `${releaseSlug}/${archive.digest}-${source.filename}`,
        originalFilename: source.filename,
        mimeType: source.mimeType,
        sizeBytes: source.bytes.byteLength,
        sha256: archive.digest,
      },
    },
    sets,
    cards,
    parallels,
    identities,
    validation: {
      status: errors.length ? "failed" : "passed",
      issues,
    },
  };
}

export function assertPlanComplexity(plan) {
  const sets = plan.sets?.length || 0;
  const cards = plan.cards?.length || 0;
  const parallels = plan.parallels?.length || 0;
  const identities = plan.identities?.length || 0;
  const serializedBytes = Buffer.byteLength(JSON.stringify(plan));
  const violations = [];
  if (sets > 2_500) violations.push(`sets=${sets}`);
  if (cards > 10_000) violations.push(`cards=${cards}`);
  if (parallels > 2_500) violations.push(`parallels=${parallels}`);
  if (identities > 100_000) violations.push(`identities=${identities}`);
  if (serializedBytes > 20 * 1024 * 1024) violations.push(`serializedBytes=${serializedBytes}`);
  if (violations.length) {
    throw new Error(`Checklist import complexity limit exceeded: ${violations.join(", ")}.`);
  }
  return { serializedBytes };
}

export async function ensureArchiveBucket(db) {
  const options = {
    public: false,
    fileSizeLimit: MAX_SOURCE_BYTES,
    allowedMimeTypes: [
      "text/html",
      "application/xhtml+xml",
      "application/pdf",
      "text/plain",
      "text/csv",
      "text/tab-separated-values",
      "application/json",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ],
  };
  const existing = await db.storage.getBucket(ARCHIVE_BUCKET);
  if (existing.error || !existing.data) {
    const created = await db.storage.createBucket(ARCHIVE_BUCKET, options);
    if (created.error && !/already exists|duplicate|409/i.test(created.error.message || "")) {
      throw new Error(`Could not create archive bucket: ${created.error.message}`);
    }
  } else if (existing.data.public) {
    throw new Error(`${ARCHIVE_BUCKET} exists but is public.`);
  }
}

export async function uploadArchive(db, source) {
  const digest = sha256(source.bytes);
  const objectPath = `${ARCHIVE_PREFIX}/blobs/${digest.slice(0, 2)}/${digest}-${source.filename}`;
  const uploaded = await db.storage.from(ARCHIVE_BUCKET).upload(objectPath, source.bytes, {
    contentType: source.mimeType,
    cacheControl: "0",
    upsert: false,
  });
  if (uploaded.error && !/already exists|duplicate|409/i.test(uploaded.error.message || "")) {
    throw new Error(`Could not archive source: ${uploaded.error.message}`);
  }
  return { digest, objectPath, bytes: source.bytes.byteLength };
}

async function uploadRegistrySource(db, plan, bytes) {
  const storage = plan.source.storage;
  const uploaded = await db.storage.from(CHECKLIST_SOURCE_BUCKET).upload(storage.objectPath, bytes, {
    contentType: storage.mimeType,
    cacheControl: "0",
    upsert: false,
  });
  if (uploaded.error && !/already exists|duplicate|409/i.test(uploaded.error.message || "")) {
    throw new Error(`Could not archive validated Registry source: ${uploaded.error.message}`);
  }
}

export function limitedIssues(values) {
  return values.slice(0, 100).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: String(issue.message || "").slice(0, 500),
  }));
}

function transientCatalogError(message) {
  return /(?:statement timeout|lock timeout|deadlock|serialization|too many requests|upstream|gateway|temporar|connection|fetch failed|timeout)/i.test(
    String(message || ""),
  );
}

function retryDelay(attempt) {
  return Math.min(8_000, 500 * 2 ** (attempt - 1));
}

export async function upsertCatalog(db, values) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { error } = await db
      .from("checklist_source_catalog")
      .upsert(values, { onConflict: "source_url" });
    if (!error) return;
    lastError = error;
    if (!transientCatalogError(error.message) || attempt === 5) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
  }
  throw new Error(`Could not update checklist source catalog: ${lastError?.message || "unknown error"}`);
}

export async function persistPlan(db, plan, bytes) {
  await uploadRegistrySource(db, plan, bytes);
  const storage = plan.source.storage;
  const { data, error } = await db.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });
  if (error) throw new Error(`Checklist Registry transaction failed: ${error.message}`);
  return data;
}
