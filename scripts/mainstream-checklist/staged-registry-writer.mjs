import { CHECKLIST_SOURCE_BUCKET } from "../../src/lib/checklist-registry/storage.ts";

const DEFAULT_CARD_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_CARD_CHUNK || 100));
const DEFAULT_PARALLEL_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_PARALLEL_CHUNK || 150));
const DEFAULT_IDENTITY_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_IDENTITY_CHUNK || 200));
const DEFAULT_SET_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_SET_CHUNK || 100));
const RPC_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_REGISTRY_RPC_ATTEMPTS || 4));

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function chunks(values, size) {
  const rows = Array.isArray(values) ? values : [];
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

function transientMessage(message) {
  return /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b52[125]\b|\b544\b|fetch failed|network/i.test(String(message || ""));
}

async function rpcWithRetry(db, name, args, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const { data, error } = await db.rpc(name, args);
      if (!error) {
        console.log(`${label} succeeded on attempt ${attempt} in ${Date.now() - started}ms.`);
        return data;
      }
      lastError = new Error(error.message || String(error));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    console.warn(`${label} attempt ${attempt}/${RPC_ATTEMPTS} failed: ${lastError.message}`);
    if (attempt >= RPC_ATTEMPTS || !transientMessage(lastError.message)) break;
    await sleep(Math.min(10_000, 1_500 * 2 ** (attempt - 1)));
  }
  throw new Error(`${label} failed: ${lastError?.message || "unknown RPC error"}`);
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

async function appendChunk(db, versionId, payload, label) {
  return rpcWithRetry(
    db,
    "tcos_append_checklist_import_chunk",
    {
      p_version_id: versionId,
      p_sets: payload.sets || [],
      p_cards: payload.cards || [],
      p_parallels: payload.parallels || [],
      p_identities: payload.identities || [],
    },
    label,
  );
}

export async function persistPlanStaged(db, plan, bytes) {
  if (plan?.validation?.status !== "passed") {
    throw new Error(`Staged Registry persistence requires a passed plan, got ${plan?.validation?.status || "missing"}.`);
  }

  await uploadRegistrySource(db, plan, bytes);
  const storage = plan.source.storage;
  const begin = await rpcWithRetry(
    db,
    "tcos_begin_checklist_import_plan",
    {
      p_plan: plan,
      p_original_filename: storage.originalFilename,
      p_mime_type: storage.mimeType,
      p_size_bytes: storage.sizeBytes,
      p_sha256: storage.sha256,
      p_storage_bucket: storage.bucket,
      p_storage_object_path: storage.objectPath,
    },
    "Registry staged begin",
  );

  if (!begin?.ok) throw new Error(`Registry staged begin did not return ok: ${JSON.stringify(begin)}`);
  if (begin.complete) return { ...begin, staged: true };

  const versionId = begin.versionId;
  if (!versionId) throw new Error("Registry staged begin did not return a versionId.");

  const setChunks = chunks(plan.sets, DEFAULT_SET_CHUNK);
  for (let index = 0; index < setChunks.length; index += 1) {
    await appendChunk(db, versionId, { sets: setChunks[index] }, `Registry sets chunk ${index + 1}/${setChunks.length}`);
  }

  const cardChunks = chunks(plan.cards, DEFAULT_CARD_CHUNK);
  for (let index = 0; index < cardChunks.length; index += 1) {
    await appendChunk(db, versionId, { cards: cardChunks[index] }, `Registry cards chunk ${index + 1}/${cardChunks.length}`);
  }

  const parallelChunks = chunks(plan.parallels, DEFAULT_PARALLEL_CHUNK);
  for (let index = 0; index < parallelChunks.length; index += 1) {
    await appendChunk(db, versionId, { parallels: parallelChunks[index] }, `Registry parallels chunk ${index + 1}/${parallelChunks.length}`);
  }

  const identityChunks = chunks(plan.identities, DEFAULT_IDENTITY_CHUNK);
  for (let index = 0; index < identityChunks.length; index += 1) {
    await appendChunk(db, versionId, { identities: identityChunks[index] }, `Registry identities chunk ${index + 1}/${identityChunks.length}`);
  }

  const counts = plan.validation.counts || {};
  const finalized = await rpcWithRetry(
    db,
    "tcos_finalize_checklist_import_plan",
    {
      p_version_id: versionId,
      p_expected_sets: Number(counts.sets || 0),
      p_expected_cards: Number(counts.cards || 0),
      p_expected_parallels: Number(counts.parallels || 0),
      p_expected_identities: Number(counts.identities || 0),
      p_validation_issues: Array.isArray(plan.validation.issues) ? plan.validation.issues : [],
    },
    "Registry staged finalize",
  );

  if (!finalized?.ok || finalized?.status !== "live") {
    throw new Error(`Registry staged finalize refused activation: ${JSON.stringify(finalized)}`);
  }
  return { ...finalized, staged: true };
}
