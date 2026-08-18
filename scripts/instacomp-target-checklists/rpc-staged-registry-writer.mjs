import { createClient } from "@supabase/supabase-js";

const SET_CHUNK = Math.max(10, Number(process.env.CHECKLIST_REGISTRY_SET_CHUNK || 25));
const CARD_CHUNK = Math.max(10, Number(process.env.CHECKLIST_REGISTRY_CARD_CHUNK || 25));
const PARALLEL_CHUNK = Math.max(10, Number(process.env.CHECKLIST_REGISTRY_PARALLEL_CHUNK || 25));
const IDENTITY_CHUNK = Math.max(10, Number(process.env.CHECKLIST_REGISTRY_IDENTITY_CHUNK || 25));
const RPC_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_REGISTRY_RPC_ATTEMPTS || 8));
const UPLOAD_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_REGISTRY_UPLOAD_ATTEMPTS || 6));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chunks = (values, size) => {
  const rows = Array.isArray(values) ? values : [];
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, index * size + size));
};
const transient = (message) => /timeout|timed out|statement timeout|lock timeout|too many connections|connection terminated|connection reset|connection refused|web server is down|ssl handshake|\b429\b|\b50[0234]\b|\b52[125]\b|\b544\b|fetch failed|network|aborted|temporar|55P03/i.test(String(message || ""));

let cachedContext = null;
function context() {
  if (cachedContext) return cachedContext;
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for direct Registry RPC.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for direct Registry RPC.");
  cachedContext = {
    supabaseUrl,
    serviceRoleKey,
    db: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "tcos-instacomp-registry-rpc/2.0" } },
    }),
  };
  return cachedContext;
}

function errorText(error) {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message;
  return [error.message, error.details, error.hint, error.code].filter(Boolean).join(" | ") || String(error);
}

async function withRetry(label, fn) {
  let last = null;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error instanceof Error ? error : new Error(errorText(error));
      console.warn(`${label} attempt ${attempt}/${RPC_ATTEMPTS} failed: ${last.message}`);
      if (attempt >= RPC_ATTEMPTS || !transient(last.message)) break;
      await sleep(Math.min(30_000, 1500 * (2 ** (attempt - 1))));
    }
  }
  throw last || new Error(`${label} failed.`);
}

async function rpc(name, args, label) {
  const { db } = context();
  return withRetry(label, async () => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(errorText(error));
    return data;
  });
}

export async function preflightReleaseRpc(releaseSlug) {
  const { db } = context();
  return withRetry(`direct preflight ${releaseSlug}`, async () => {
    const releases = await db.from("checklist_releases").select("id").eq("slug", releaseSlug).limit(10);
    if (releases.error) throw new Error(errorText(releases.error));
    const releaseIds = (releases.data || []).map((row) => row.id).filter(Boolean);
    if (!releaseIds.length) return { complete: false, reason: "no_release" };
    const versions = await db
      .from("checklist_versions")
      .select("id,release_id,status,version_number,normalized_card_count,normalized_identity_count,is_active")
      .in("release_id", releaseIds)
      .eq("is_active", true)
      .in("status", ["live", "revised"])
      .gt("normalized_card_count", 0)
      .gt("normalized_identity_count", 0)
      .order("version_number", { ascending: false })
      .limit(1);
    if (versions.error) throw new Error(errorText(versions.error));
    const row = versions.data?.[0];
    if (!row) return { complete: false, reason: "no_complete_active_version" };
    return {
      complete: true,
      releaseId: row.release_id,
      versionId: row.id,
      status: row.status,
      cards: row.normalized_card_count,
      identities: row.normalized_identity_count,
    };
  });
}

async function uploadRegistrySource(plan, bytes, { reuseArchivedSourceOnTransient = false } = {}) {
  const storage = plan?.source?.storage;
  if (!storage?.bucket || !storage?.objectPath) throw new Error("Validated Registry source storage metadata is incomplete.");
  const { db } = context();
  let last = null;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const uploaded = await db.storage.from(storage.bucket).upload(storage.objectPath, bytes, {
        contentType: storage.mimeType,
        cacheControl: "0",
        upsert: false,
      });
      if (!uploaded.error || /already exists|duplicate|409/i.test(uploaded.error.message || "")) return;
      last = new Error(errorText(uploaded.error));
    } catch (error) {
      last = error instanceof Error ? error : new Error(errorText(error));
    }
    console.warn(`Registry source upload attempt ${attempt}/${UPLOAD_ATTEMPTS} failed: ${last.message}`);
    if (attempt >= UPLOAD_ATTEMPTS || !transient(last.message)) break;
    await sleep(Math.min(30_000, 2000 * attempt));
  }
  if (reuseArchivedSourceOnTransient && transient(last?.message)) {
    console.warn(`Reusing previously archived deterministic Registry source after transient Storage failure: ${storage.bucket}/${storage.objectPath}`);
    return;
  }
  throw new Error(`Could not archive validated Registry source: ${last?.message || "unknown storage error"}`);
}

function compactBeginPlan(plan) {
  return {
    schema: plan.schema,
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
    source: plan.source,
    release: plan.release,
    validation: {
      status: plan.validation?.status,
      counts: plan.validation?.counts,
    },
  };
}

async function beginPlan(plan) {
  const storage = plan.source.storage;
  return rpc("tcos_begin_checklist_import_plan", {
    p_plan: compactBeginPlan(plan),
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: Number(storage.sizeBytes || 0),
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  }, `direct Registry begin ${plan.release.releaseSlug}`);
}

async function appendChunk(versionId, payload, label) {
  return rpc("tcos_append_checklist_import_chunk", {
    p_version_id: versionId,
    p_sets: payload.sets || [],
    p_cards: payload.cards || [],
    p_parallels: payload.parallels || [],
    p_identities: payload.identities || [],
  }, label);
}

async function finalizePlan(versionId, counts, issues, releaseSlug) {
  return rpc("tcos_finalize_checklist_import_plan", {
    p_version_id: versionId,
    p_expected_sets: Number(counts.sets || 0),
    p_expected_cards: Number(counts.cards || 0),
    p_expected_parallels: Number(counts.parallels || 0),
    p_expected_identities: Number(counts.identities || 0),
    p_validation_issues: Array.isArray(issues) ? issues : [],
  }, `direct Registry finalize ${releaseSlug}`);
}

function canonicalizeSetAliases(plan) {
  const norm = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replaceAll("&", " and ").replace(/[^\p{L}\p{N}]+/gu, "").trim();
  const kept = new Map();
  const alias = new Map();
  const sets = [];
  for (const set of plan.sets || []) {
    const key = norm(set.normalizedName || set.name || set.sourceKey);
    const prior = kept.get(key);
    if (!prior) {
      kept.set(key, set);
      alias.set(String(set.sourceKey), String(set.sourceKey));
      sets.push(set);
    } else {
      alias.set(String(set.sourceKey), String(prior.sourceKey));
    }
  }
  const remap = (row) => ({ ...row, setSourceKey: alias.get(String(row.setSourceKey)) || row.setSourceKey });
  const cards = (plan.cards || []).map(remap);
  const parallels = (plan.parallels || []).map(remap);
  return { ...plan, sets, cards, parallels, validation: { ...plan.validation, counts: { ...plan.validation.counts, sets: sets.length } } };
}

function canonicalizeCardAliases(plan) {
  const norm = (value) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const kept = new Map();
  const alias = new Map();
  const cards = [];
  for (const card of plan.cards || []) {
    const natural = `${String(card.setSourceKey ?? "")}\u0000${norm(card.cardNumber ?? card.number ?? "")}`;
    const prior = kept.get(natural);
    if (!prior) {
      kept.set(natural, card);
      alias.set(String(card.sourceKey), String(card.sourceKey));
      cards.push(card);
    } else {
      alias.set(String(card.sourceKey), String(prior.sourceKey));
      prior.players = [...new Set([...(prior.players || []), ...(card.players || [])])];
      prior.teams = [...new Set([...(prior.teams || []), ...(card.teams || [])])];
    }
  }
  const remapCard = (row) => row?.cardSourceKey ? ({ ...row, cardSourceKey: alias.get(String(row.cardSourceKey)) || row.cardSourceKey }) : row;
  const identities = (plan.identities || []).map(remapCard);
  const parallels = (plan.parallels || []).map(remapCard);
  return { ...plan, cards, parallels, identities, validation: { ...plan.validation, counts: { ...plan.validation.counts, cards: cards.length } } };
}

export async function persistPlanRpc(inputPlan, bytes, options = {}) {
  let plan = canonicalizeCardAliases(canonicalizeSetAliases(inputPlan));
  if (plan?.validation?.status !== "passed") {
    throw new Error(`Direct staged persistence requires a passed plan, got ${plan?.validation?.status || "missing"}.`);
  }

  await uploadRegistrySource(plan, bytes, options);
  const begin = await beginPlan(plan);
  if (!begin?.ok) throw new Error(`Direct Registry begin did not return ok: ${JSON.stringify(begin)}`);
  if (begin.complete) return { ...begin, staged: true, transport: "service_role_rpc" };
  const versionId = begin.versionId;
  if (!versionId) throw new Error("Direct Registry begin did not return a versionId.");

  const setByKey = new Map((plan.sets || []).map((row) => [String(row.sourceKey), row]));
  const cardByKey = new Map((plan.cards || []).map((row) => [String(row.sourceKey), row]));
  const parallelByKey = new Map((plan.parallels || []).map((row) => [String(row.sourceKey), row]));
  const unique = (rows) => [...new Map(rows.filter(Boolean).map((row) => [String(row.sourceKey), row])).values()];

  const setChunks = chunks(plan.sets, SET_CHUNK);
  for (let i = 0; i < setChunks.length; i += 1) {
    await appendChunk(versionId, { sets: setChunks[i] }, `direct Registry sets ${i + 1}/${setChunks.length} ${plan.release.releaseSlug}`);
  }

  const cardChunks = chunks(plan.cards, CARD_CHUNK);
  for (let i = 0; i < cardChunks.length; i += 1) {
    const sets = unique(cardChunks[i].map((card) => setByKey.get(String(card.setSourceKey))));
    await appendChunk(versionId, { sets, cards: cardChunks[i] }, `direct Registry cards ${i + 1}/${cardChunks.length} ${plan.release.releaseSlug}`);
  }

  const parallelChunks = chunks(plan.parallels, PARALLEL_CHUNK);
  for (let i = 0; i < parallelChunks.length; i += 1) {
    const sets = unique(parallelChunks[i].map((parallel) => setByKey.get(String(parallel.setSourceKey))));
    await appendChunk(versionId, { sets, parallels: parallelChunks[i] }, `direct Registry parallels ${i + 1}/${parallelChunks.length} ${plan.release.releaseSlug}`);
  }

  const identityChunks = chunks(plan.identities, IDENTITY_CHUNK);
  for (let i = 0; i < identityChunks.length; i += 1) {
    const cards = unique(identityChunks[i].map((identity) => cardByKey.get(String(identity.cardSourceKey))));
    const parallels = unique(identityChunks[i].map((identity) => identity.parallelSourceKey ? parallelByKey.get(String(identity.parallelSourceKey)) : null));
    const sets = unique([
      ...cards.map((card) => setByKey.get(String(card.setSourceKey))),
      ...parallels.map((parallel) => setByKey.get(String(parallel.setSourceKey))),
    ]);
    await appendChunk(versionId, { sets, cards, parallels, identities: identityChunks[i] }, `direct Registry identities ${i + 1}/${identityChunks.length} ${plan.release.releaseSlug}`);
  }

  const finalized = await finalizePlan(versionId, plan.validation.counts || {}, plan.validation.issues || [], plan.release.releaseSlug);
  if (!finalized?.ok || finalized?.status !== "live") {
    throw new Error(`Direct Registry finalize refused activation: ${JSON.stringify(finalized)}`);
  }
  return { ...finalized, staged: true, transport: "service_role_rpc" };
}
