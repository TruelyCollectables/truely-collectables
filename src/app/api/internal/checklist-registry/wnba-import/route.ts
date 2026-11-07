import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticateWnbaChecklistAction } from "@/src/lib/github-actions-wnba-checklist-oidc";
import { buildChecklistIdentityFingerprint } from "@/src/lib/checklist-registry/identity";
import { assertChecklistPlanComplexity } from "@/src/lib/checklist-registry/server";
import type { ChecklistImportPlan } from "@/src/lib/checklist-registry/source-adapter";
import { buildChecklistSourceStorageReceipt } from "@/src/lib/checklist-registry/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const CATALOG_RETRY_ATTEMPTS = 6;
const CATALOG_RETRY_BASE_MS = 500;
const ALLOWED_RELEASES = new Map([
  ["2024-panini-origins-wnba", { year: "2024", brand: "Origins", product: "Origins WNBA" }],
  ["2024-panini-prizm-wnba", { year: "2024", brand: "Prizm", product: "Prizm WNBA" }],
  ["2024-panini-select-wnba", { year: "2024", brand: "Select", product: "Select WNBA" }],
  ["2025-panini-donruss-wnba", { year: "2025", brand: "Donruss", product: "Donruss WNBA" }],
  ["2025-panini-impeccable-wnba", { year: "2025", brand: "Impeccable", product: "Impeccable WNBA" }],
  ["2025-panini-one-and-one-wnba", { year: "2025", brand: "One and One", product: "One and One WNBA" }],
  ["2025-panini-prizm-wnba", { year: "2025", brand: "Prizm", product: "Prizm WNBA" }],
  ["2025-panini-select-wnba", { year: "2025", brand: "Select", product: "Select WNBA" }],
]);

type WnbaImportPayload = {
  operation: "import_required_wnba_checklist";
  sourceUrl: string;
  sourceSha256: string;
  originalFilename: string;
  sourceBase64: string;
  plan: ChecklistImportPlan;
};

type CatalogError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Checklist Registry production credentials are unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function issueSummary(plan: ChecklistImportPlan) {
  return plan.validation.issues.slice(0, 50).map((value) => ({
    code: clean(value.code).slice(0, 100),
    severity: clean(value.severity).slice(0, 20),
    message: clean(value.message).slice(0, 500),
  }));
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isTransientCatalogError(error: CatalogError | null | undefined) {
  if (!error) return false;
  const code = clean(error.code).toUpperCase();
  if (/^PGRST00[0-3]$/.test(code)) return true;
  const text = [error.message, error.details, error.hint, error.code].map(clean).join(" ");
  return /\b(?:408|425|429|500|502|503|504|521)\b|fetch failed|schema cache|connection (?:closed|reset|refused)|network error|timed? out|temporarily unavailable|web server is down/i.test(text);
}

async function readCatalog(db: ReturnType<typeof serviceClient>, sourceUrl: string) {
  for (let attempt = 1; attempt <= CATALOG_RETRY_ATTEMPTS; attempt += 1) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("status,source_sha256,metadata")
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (!error) return data;
    if (!isTransientCatalogError(error) || attempt === CATALOG_RETRY_ATTEMPTS) {
      throw new Error(`Could not read checklist source catalog: ${error.message}`);
    }
    const delay = Math.min(8_000, CATALOG_RETRY_BASE_MS * 2 ** (attempt - 1));
    console.warn(`[wnba-checklist-import] transient catalog read failure; retry ${attempt}/${CATALOG_RETRY_ATTEMPTS} in ${delay}ms: ${error.message}`);
    await sleep(delay);
  }
  throw new Error("Could not read checklist source catalog after bounded retries.");
}

async function upsertCatalogReceipt(
  db: ReturnType<typeof serviceClient>,
  row: Record<string, unknown>,
) {
  for (let attempt = 1; attempt <= CATALOG_RETRY_ATTEMPTS; attempt += 1) {
    const { error } = await db.from("checklist_source_catalog").upsert(row, { onConflict: "source_url" });
    if (!error) return;
    if (!isTransientCatalogError(error) || attempt === CATALOG_RETRY_ATTEMPTS) {
      throw new Error(`Could not update WNBA checklist catalog receipt: ${error.message}`);
    }
    const delay = Math.min(8_000, CATALOG_RETRY_BASE_MS * 2 ** (attempt - 1));
    console.warn(`[wnba-checklist-import] transient catalog receipt failure; retry ${attempt}/${CATALOG_RETRY_ATTEMPTS} in ${delay}ms: ${error.message}`);
    await sleep(delay);
  }
  throw new Error("Could not update WNBA checklist catalog receipt after bounded retries.");
}

function assertTrustedSource(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)gogts\.net$/i.test(url.hostname) ||
    !/\.xls$/i.test(url.pathname)
  ) {
    throw new Error("WNBA checklist source URL is not an approved GoGTS XLS source.");
  }
}

function assertPlanShape(plan: ChecklistImportPlan) {
  if (!plan || plan.schema !== "tcos.checklist.importPlan.v1") {
    throw new Error("WNBA checklist import plan schema is invalid.");
  }
  const allowed = ALLOWED_RELEASES.get(plan.release?.releaseSlug || "");
  if (!allowed) throw new Error("WNBA checklist release is not in the required eight-release allowlist.");
  if (
    plan.release.manufacturer !== "Panini" ||
    plan.release.sport !== "Basketball" ||
    plan.release.league !== "WNBA" ||
    plan.release.releaseYear !== allowed.year ||
    plan.release.brand !== allowed.brand ||
    plan.release.product !== allowed.product
  ) {
    throw new Error(`WNBA checklist release metadata mismatch for ${plan.release.releaseSlug}.`);
  }
  if (
    !Array.isArray(plan.sets) ||
    !Array.isArray(plan.cards) ||
    !Array.isArray(plan.parallels) ||
    !Array.isArray(plan.identities) ||
    plan.validation?.status !== "passed"
  ) {
    throw new Error("WNBA checklist plan is incomplete or did not pass validation.");
  }
  if (plan.validation.issues.some((issue) => issue.severity === "error")) {
    throw new Error("WNBA checklist plan contains validation errors.");
  }
  const counts = plan.validation.counts;
  if (
    counts.sets !== plan.sets.length ||
    counts.cards !== plan.cards.length ||
    counts.parallels !== plan.parallels.length ||
    counts.identities !== plan.identities.length
  ) {
    throw new Error("WNBA checklist validation counts do not match the import plan arrays.");
  }
  if (plan.identities.length < 100) {
    throw new Error("WNBA checklist plan contains too few identities.");
  }

  const cardKeys = new Set(plan.cards.map((card) => card.sourceKey));
  const parallelKeys = new Set(plan.parallels.map((parallel) => parallel.sourceKey));
  const setKeys = new Set(plan.sets.map((set) => set.sourceKey));
  for (const card of plan.cards) {
    if (!setKeys.has(card.setSourceKey)) throw new Error(`Card ${card.sourceKey} references an unknown set.`);
  }
  for (const parallel of plan.parallels) {
    if (!setKeys.has(parallel.setSourceKey)) throw new Error(`Parallel ${parallel.sourceKey} references an unknown set.`);
  }
  for (const identity of plan.identities) {
    if (!cardKeys.has(identity.cardSourceKey)) {
      throw new Error(`Identity references unknown card ${identity.cardSourceKey}.`);
    }
    if (identity.parallelSourceKey && !parallelKeys.has(identity.parallelSourceKey)) {
      throw new Error(`Identity references unknown parallel ${identity.parallelSourceKey}.`);
    }
    const normalized = identity.fingerprint.normalized;
    const rebuilt = buildChecklistIdentityFingerprint({
      releaseYear: normalized.releaseYear,
      season: normalized.season,
      manufacturer: normalized.manufacturer,
      brand: normalized.brand,
      product: normalized.product,
      sport: normalized.sport,
      league: normalized.league,
      setName: normalized.setName,
      subset: normalized.subset,
      cardNumber: normalized.cardNumber,
      players: normalized.players,
      teams: normalized.teams,
      parallel: normalized.parallel,
      variation: normalized.variation,
      serialRun: normalized.serialRun,
      autographStatus: normalized.autographStatus,
      memorabiliaStatus: normalized.memorabiliaStatus,
      configurationExclusivity: normalized.configurationExclusivity,
    });
    if (
      rebuilt.fingerprintSha256 !== identity.fingerprint.fingerprintSha256 ||
      rebuilt.canonicalKey !== identity.fingerprint.canonicalKey
    ) {
      throw new Error(`Identity fingerprint integrity check failed for ${identity.cardSourceKey}.`);
    }
  }
  assertChecklistPlanComplexity(plan);
}

async function processImport(payload: WnbaImportPayload) {
  if (payload.operation !== "import_required_wnba_checklist") {
    throw new Error("Unsupported WNBA checklist import operation.");
  }
  assertTrustedSource(payload.sourceUrl);
  if (!/^[a-f0-9]{64}$/i.test(payload.sourceSha256)) {
    throw new Error("WNBA checklist source digest is invalid.");
  }
  if (!payload.originalFilename || payload.originalFilename.length > 255) {
    throw new Error("WNBA checklist original filename is invalid.");
  }
  if (typeof payload.sourceBase64 !== "string" || payload.sourceBase64.length < 100) {
    throw new Error("WNBA checklist source content is missing.");
  }

  const bytes = Buffer.from(payload.sourceBase64, "base64");
  if (bytes.byteLength < 1_000 || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`WNBA checklist XLS size ${bytes.byteLength} is outside the allowed range.`);
  }
  const sourceSha256 = sha256(bytes);
  if (sourceSha256 !== payload.sourceSha256.toLowerCase()) {
    throw new Error("WNBA checklist source digest does not match the uploaded XLS bytes.");
  }
  if (bytes.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1") {
    throw new Error("WNBA checklist source is not an OLE XLS file.");
  }

  const plan = structuredClone(payload.plan);
  assertPlanShape(plan);
  const retrievedAt = new Date().toISOString();
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "Panini",
    releaseSlug: plan.release.releaseSlug,
    originalFilename: payload.originalFilename,
    mimeType: "application/vnd.ms-excel",
    content: bytes,
  });
  if (storage.sha256 !== sourceSha256) throw new Error("Checklist storage receipt digest mismatch.");
  plan.source = {
    sourceUrl: payload.sourceUrl,
    retrievedAt,
    authority: "approved_distributor",
    redistributionAllowed: false,
    privateArchiveRequired: true,
    normalizedFactsInternalOnly: true,
    storage,
  };

  const normalizedPlanSha256 = sha256(JSON.stringify({
    release: plan.release,
    sets: plan.sets,
    cards: plan.cards,
    parallels: plan.parallels,
    identities: plan.identities,
  }));
  const db = serviceClient();
  const existing = await readCatalog(db, payload.sourceUrl);
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, unknown>
    : {};
  if (
    existing?.status === "imported" &&
    existing?.source_sha256 === sourceSha256 &&
    existingMetadata.normalizedPlanSha256 === normalizedPlanSha256
  ) {
    return {
      status: "unchanged",
      release: plan.release.releaseSlug,
      counts: plan.validation.counts,
      sourceSha256,
      normalizedPlanSha256,
      persistence: null,
    };
  }

  let uploadedByThisRequest = false;
  const { error: uploadError } = await db.storage
    .from(storage.bucket)
    .upload(storage.objectPath, bytes, {
      contentType: storage.mimeType,
      upsert: false,
      cacheControl: "0",
    });
  if (uploadError) {
    const duplicate = /already exists|duplicate|409/i.test(uploadError.message || "");
    if (!duplicate) throw new Error(`Could not archive WNBA checklist source: ${uploadError.message}`);
  } else {
    uploadedByThisRequest = true;
  }

  const { data: persistence, error: importError } = await db.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });
  if (importError) {
    if (uploadedByThisRequest) {
      await db.storage.from(storage.bucket).remove([storage.objectPath]);
    }
    throw new Error(`WNBA Checklist Registry transaction failed: ${importError.message}`);
  }

  const releaseName = `${plan.release.releaseYear} ${plan.release.product}`;
  await upsertCatalogReceipt(db, {
    manufacturer: "Panini",
    sport: "Basketball",
    source_url: payload.sourceUrl,
    source_sha256: sourceSha256,
    release_slug: plan.release.releaseSlug,
    release_name: releaseName,
    adapter_id: plan.adapterId,
    adapter_version: plan.adapterVersion,
    status: "imported",
    last_seen_at: retrievedAt,
    last_checked_at: retrievedAt,
    imported_at: retrievedAt,
    validation_counts: plan.validation.counts,
    issue_summary: issueSummary(plan),
    metadata: {
      releaseYear: plan.release.releaseYear,
      brand: plan.release.brand,
      league: "WNBA",
      requiredWnbaBatch: true,
      normalizedPlanSha256,
    },
  });

  return {
    status: "imported",
    release: plan.release.releaseSlug,
    counts: plan.validation.counts,
    sourceSha256,
    normalizedPlanSha256,
    persistence,
  };
}

export async function POST(request: Request) {
  try {
    await authenticateWnbaChecklistAction(request);
    const payload = (await request.json()) as WnbaImportPayload;
    return Response.json({ ok: true, result: await processImport(payload) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WNBA checklist import failed.";
    const unauthorized = /authorization|OIDC|workflow|repository|issuer|audience|ref mismatch|event is not trusted/i.test(message);
    console.error("[wnba-checklist-import]", message);
    return Response.json(
      { ok: false, message: unauthorized ? "WNBA checklist import authorization failed." : message },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
