import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SET_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_SET_CHUNK || 100));
const CARD_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_CARD_CHUNK || 75));
const PARALLEL_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_PARALLEL_CHUNK || 100));
const IDENTITY_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_IDENTITY_CHUNK || 150));
const QUERY_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_MANAGEMENT_QUERY_ATTEMPTS || 5));
const UPLOAD_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_REGISTRY_UPLOAD_ATTEMPTS || 5));

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const chunks = (values, size) => {
  const rows = Array.isArray(values) ? values : [];
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, index * size + size));
};
const transient = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b52[125]\b|\b544\b|fetch failed|network|aborted|temporar/i.test(String(message || ""));

function managementContext() {
  const accessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "");
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co$/i);
  if (!accessToken) throw new Error("GH_SUPABASE_ACCESS_TOKEN is required for management SQL writes.");
  if (!match?.[1]) throw new Error(`Could not infer Supabase project ref from ${supabaseUrl || "missing URL"}.`);
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for source archival.");
  return { accessToken, projectRef: match[1], supabaseUrl, serviceRoleKey };
}

function dollar(value, prefix = "tc") {
  const text = String(value ?? "");
  const tag = `${prefix}_${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
  return `$${tag}$${text}$${tag}$`;
}
function jsonSql(value, prefix) {
  return `${dollar(JSON.stringify(value ?? null), prefix)}::jsonb`;
}
function textSql(value, prefix) {
  if (value === null || value === undefined) return "null::text";
  return `${dollar(String(value), prefix)}::text`;
}

export async function managementQuery(sql, label = "Supabase management SQL") {
  const { accessToken, projectRef } = managementContext();
  let last = null;
  for (let attempt = 1; attempt <= QUERY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: sql, read_only: false }),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : [];
      last = new Error(`${label} HTTP ${response.status}: ${text.slice(0, 1200)}`);
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
    console.warn(`${label} attempt ${attempt}/${QUERY_ATTEMPTS} failed: ${last.message}`);
    if (attempt >= QUERY_ATTEMPTS || !transient(last.message)) break;
    await sleep(Math.min(30_000, 2_000 * attempt));
  }
  throw last || new Error(`${label} failed.`);
}

function resultValue(rows, label) {
  if (!Array.isArray(rows) || !rows.length || rows[0]?.result === undefined) {
    throw new Error(`${label} returned an unexpected payload: ${JSON.stringify(rows).slice(0, 1000)}`);
  }
  return rows[0].result;
}

export async function preflightReleaseManagement(releaseSlug) {
  const sql = `
select jsonb_build_object(
  'complete', true,
  'releaseId', r.id,
  'versionId', v.id,
  'status', v.status,
  'cards', v.normalized_card_count,
  'identities', v.normalized_identity_count
) as result
from public.checklist_releases r
join public.checklist_versions v on v.release_id = r.id
where r.slug = ${textSql(releaseSlug, "slug")}
  and v.is_active = true
  and v.status in ('live','revised')
  and coalesce(v.normalized_card_count,0) > 0
  and coalesce(v.normalized_identity_count,0) > 0
order by v.version_number desc
limit 1;`;
  const rows = await managementQuery(sql, `management preflight ${releaseSlug}`);
  if (!Array.isArray(rows) || !rows.length) return { complete: false, reason: "no_complete_active_version" };
  return rows[0].result || { complete: false, reason: "no_complete_active_version" };
}

async function uploadRegistrySource(plan, bytes) {
  const storage = plan?.source?.storage;
  if (!storage?.bucket || !storage?.objectPath) throw new Error("Validated Registry source storage metadata is incomplete.");
  const { supabaseUrl, serviceRoleKey } = managementContext();
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let last = null;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const uploaded = await db.storage.from(storage.bucket).upload(storage.objectPath, bytes, {
        contentType: storage.mimeType,
        cacheControl: "0",
        upsert: false,
      });
      if (!uploaded.error || /already exists|duplicate|409/i.test(uploaded.error.message || "")) return;
      last = new Error(uploaded.error.message || String(uploaded.error));
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
    console.warn(`Registry source upload attempt ${attempt}/${UPLOAD_ATTEMPTS} failed: ${last.message}`);
    if (attempt >= UPLOAD_ATTEMPTS || !transient(last.message)) break;
    await sleep(Math.min(30_000, 2_000 * attempt));
  }
  throw new Error(`Could not archive validated Registry source: ${last?.message || "unknown storage error"}`);
}

async function beginPlan(plan) {
  const storage = plan.source.storage;
  const sql = `select public.tcos_begin_checklist_import_plan(
    ${jsonSql(plan, "plan")},
    ${textSql(storage.originalFilename, "filename")},
    ${textSql(storage.mimeType, "mime")},
    ${Number(storage.sizeBytes || 0)}::bigint,
    ${textSql(storage.sha256, "sha")},
    ${textSql(storage.bucket, "bucket")},
    ${textSql(storage.objectPath, "object")}
  ) as result;`;
  return resultValue(await managementQuery(sql, "Registry staged begin via management SQL"), "Registry staged begin");
}

async function appendChunk(versionId, payload, label) {
  const sql = `select public.tcos_append_checklist_import_chunk(
    ${textSql(versionId, "version")}::uuid,
    ${jsonSql(payload.sets || [], "sets")},
    ${jsonSql(payload.cards || [], "cards")},
    ${jsonSql(payload.parallels || [], "parallels")},
    ${jsonSql(payload.identities || [], "identities")}
  ) as result;`;
  return resultValue(await managementQuery(sql, label), label);
}

async function finalizePlan(versionId, counts, issues) {
  const sql = `select public.tcos_finalize_checklist_import_plan(
    ${textSql(versionId, "version") }::uuid,
    ${Number(counts.sets || 0)}::integer,
    ${Number(counts.cards || 0)}::integer,
    ${Number(counts.parallels || 0)}::integer,
    ${Number(counts.identities || 0)}::integer,
    ${jsonSql(Array.isArray(issues) ? issues : [], "issues")}
  ) as result;`;
  return resultValue(await managementQuery(sql, "Registry staged finalize via management SQL"), "Registry staged finalize");
}

export async function persistPlanManagement(plan, bytes) {
  if (plan?.validation?.status !== "passed") {
    throw new Error(`Management staged persistence requires a passed plan, got ${plan?.validation?.status || "missing"}.`);
  }
  await uploadRegistrySource(plan, bytes);
  const begin = await beginPlan(plan);
  if (!begin?.ok) throw new Error(`Registry staged begin did not return ok: ${JSON.stringify(begin)}`);
  if (begin.complete) return { ...begin, staged: true, transport: "management_sql" };
  const versionId = begin.versionId;
  if (!versionId) throw new Error("Registry staged begin did not return a versionId.");

  const setChunks = chunks(plan.sets, SET_CHUNK);
  for (let i = 0; i < setChunks.length; i += 1) await appendChunk(versionId, { sets: setChunks[i] }, `Registry sets ${i + 1}/${setChunks.length} via management SQL`);
  const cardChunks = chunks(plan.cards, CARD_CHUNK);
  for (let i = 0; i < cardChunks.length; i += 1) await appendChunk(versionId, { cards: cardChunks[i] }, `Registry cards ${i + 1}/${cardChunks.length} via management SQL`);
  const parallelChunks = chunks(plan.parallels, PARALLEL_CHUNK);
  for (let i = 0; i < parallelChunks.length; i += 1) await appendChunk(versionId, { parallels: parallelChunks[i] }, `Registry parallels ${i + 1}/${parallelChunks.length} via management SQL`);
  const identityChunks = chunks(plan.identities, IDENTITY_CHUNK);
  for (let i = 0; i < identityChunks.length; i += 1) await appendChunk(versionId, { identities: identityChunks[i] }, `Registry identities ${i + 1}/${identityChunks.length} via management SQL`);

  const counts = plan.validation.counts || {};
  const finalized = await finalizePlan(versionId, counts, plan.validation.issues || []);
  if (!finalized?.ok || finalized?.status !== "live") throw new Error(`Registry staged finalize refused activation: ${JSON.stringify(finalized)}`);
  return { ...finalized, staged: true, transport: "management_sql" };
}
