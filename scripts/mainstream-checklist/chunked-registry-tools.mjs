import { CHECKLIST_SOURCE_BUCKET } from "../../src/lib/checklist-registry/storage.ts";

const CHUNK_SIZES = Object.freeze({
  sets: 100,
  cards: 100,
  parallels: 100,
  identities: 200,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transient(message) {
  return /timed? out|too many connections|connection.*database|fetch failed|socket|econn|520|503|504|502|429|cloudflare|web server is returning|temporar/i.test(
    String(message || ""),
  );
}

async function rpcWithRetry(db, name, args, label, attempts = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await db.rpc(name, args);
    if (!error) return data;
    lastError = error;
    const message = `${label}: ${error.message || "unknown Supabase RPC error"}`;
    if (!transient(message) || attempt === attempts) throw new Error(message);
    const delay = Math.min(8_000, 800 * 2 ** (attempt - 1));
    console.warn(`${message}; retry ${attempt}/${attempts} after ${delay}ms`);
    await sleep(delay);
  }
  throw new Error(`${label}: ${lastError?.message || "unknown Supabase RPC error"}`);
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

function scaffoldPlan(plan) {
  return {
    ...plan,
    sets: [],
    cards: [],
    parallels: [],
    identities: [],
    validation: {
      ...plan.validation,
      issues: [],
      counts: { ...plan.validation.counts },
    },
  };
}

function chunkKey(kind, start, end, total) {
  return `${kind}-${String(start).padStart(6, "0")}-${String(end).padStart(6, "0")}-of-${String(total).padStart(6, "0")}`;
}

async function appendPhase(db, versionId, kind, rows) {
  const size = CHUNK_SIZES[kind];
  if (!size) throw new Error(`No chunk size configured for ${kind}.`);
  for (let start = 0; start < rows.length; start += size) {
    const chunk = rows.slice(start, start + size);
    const end = start + chunk.length - 1;
    const key = chunkKey(kind, start, end, rows.length);
    const receipt = await rpcWithRetry(
      db,
      "tcos_append_checklist_chunk",
      {
        p_version_id: versionId,
        p_chunk_kind: kind,
        p_chunk_key: key,
        p_rows: chunk,
      },
      `Registry ${kind} chunk ${key}`,
    );
    if (!receipt?.ok || Number(receipt?.resolved) !== chunk.length) {
      throw new Error(`Registry ${kind} chunk ${key} did not certify ${chunk.length}/${chunk.length} rows.`);
    }
    console.log(
      `[chunked-registry] ${kind} ${Math.min(end + 1, rows.length)}/${rows.length}` +
        (receipt.idempotent ? " (resume)" : ""),
    );
  }
}

export async function persistChunkedPlan(db, plan, bytes) {
  await uploadRegistrySource(db, plan, bytes);
  const storage = plan.source.storage;
  const begin = await rpcWithRetry(
    db,
    "tcos_begin_checklist_chunked_import",
    {
      p_plan: scaffoldPlan(plan),
      p_original_filename: storage.originalFilename,
      p_mime_type: storage.mimeType,
      p_size_bytes: storage.sizeBytes,
      p_sha256: storage.sha256,
      p_storage_bucket: storage.bucket,
      p_storage_object_path: storage.objectPath,
    },
    "Checklist Registry chunked begin",
  );

  if (!begin?.ok || !begin?.versionId) {
    throw new Error("Checklist Registry chunked begin did not return a valid version.");
  }
  if (begin.alreadyLive) {
    return {
      ...begin,
      chunked: true,
      idempotent: true,
      counts: { ...plan.validation.counts, errors: 0 },
    };
  }

  const versionId = begin.versionId;
  console.log(
    `[chunked-registry] version=${versionId} resumed=${Boolean(begin.resumed)} ` +
      `sets=${plan.sets.length} cards=${plan.cards.length} parallels=${plan.parallels.length} identities=${plan.identities.length}`,
  );

  await appendPhase(db, versionId, "sets", plan.sets);
  await appendPhase(db, versionId, "cards", plan.cards);
  await appendPhase(db, versionId, "parallels", plan.parallels);
  await appendPhase(db, versionId, "identities", plan.identities);

  const counts = plan.validation.counts;
  const finalized = await rpcWithRetry(
    db,
    "tcos_finalize_checklist_chunked_import",
    {
      p_version_id: versionId,
      p_expected_sets: counts.sets,
      p_expected_cards: counts.cards,
      p_expected_parallels: counts.parallels,
      p_expected_identities: counts.identities,
      p_issues: plan.validation.issues || [],
    },
    "Checklist Registry chunked finalize",
  );

  if (!finalized?.ok || finalized?.status !== "live") {
    throw new Error("Checklist Registry chunked finalize did not activate a certified live version.");
  }
  return finalized;
}
