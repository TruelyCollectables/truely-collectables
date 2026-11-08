import { createClient } from "@supabase/supabase-js";
import { importChecklistArtifact } from "@/src/lib/checklist-registry/server";
import type {
  ChecklistImportPlan,
  ChecklistSourceArtifact,
} from "@/src/lib/checklist-registry/source-adapter";
import { CHECKLIST_SOURCE_BUCKET } from "@/src/lib/checklist-registry/storage";
import { authenticateChecklistDiscoveryAction } from "@/src/lib/github-actions-checklist-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REPOSITORY = "TruelyCollectables/truely-collectables";
const UPPER_DECK_WORKFLOW = `${REPOSITORY}/.github/workflows/automatic-checklist-discovery.yml@refs/heads/main`;
const MAX_UPPER_DECK_HTML_BYTES = 32 * 1024 * 1024;
const MAX_NORMALIZED_PLAN_BYTES = 50 * 1024 * 1024;
const STAGED_INGEST_REVISION = "2026-08-19-hockey-staged-plan-v1";
const PLAN_SUFFIX = ".normalized-plan.json";
const CHUNK_SIZES = {
  sets: 200,
  cards: 150,
  parallels: 200,
  identities: 500,
} as const;

type StagedKind = keyof typeof CHUNK_SIZES;

type AppendStage = {
  phase: "append";
  versionId: string;
  sourceSha256: string;
  kind: StagedKind;
  offset: number;
  identityRepair?: boolean;
};

type FinalizeStage = {
  phase: "finalize";
  versionId: string;
  sourceSha256: string;
  identityRepair?: boolean;
};

type StagedRequest = AppendStage | FinalizeStage;

type UpperDeckPayload = {
  operation: "upper_deck_source";
  sourceUrl: string;
  content?: string;
  autoImport?: boolean;
  stage?: StagedRequest;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Checklist Registry production credentials are unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function assertUpperDeckUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)upperdeck\.com$/i.test(url.hostname)) {
    throw new Error("Upper Deck checklist source URL is not trusted.");
  }
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function issueSummary(values: Array<{ code: string; severity: string; message: string }>) {
  return values.slice(0, 50).map((value) => ({
    code: String(value.code || "unknown").slice(0, 100),
    severity: String(value.severity || "error").slice(0, 20),
    message: String(value.message || "").slice(0, 500),
  }));
}

function releaseName(plan: ChecklistImportPlan) {
  return [plan.release.season || plan.release.releaseYear, plan.release.product]
    .filter(Boolean)
    .join(" ");
}

function catalogValues(plan: ChecklistImportPlan, status: string) {
  const checkedAt = new Date().toISOString();
  return {
    manufacturer: plan.release.manufacturer,
    sport: plan.release.sport,
    source_url: plan.source.sourceUrl,
    source_sha256: plan.source.storage.sha256,
    release_slug: plan.release.releaseSlug,
    release_name: releaseName(plan),
    adapter_id: plan.adapterId,
    adapter_version: plan.adapterVersion,
    status,
    last_seen_at: checkedAt,
    last_checked_at: checkedAt,
    ...(status === "imported" ? { imported_at: checkedAt } : {}),
    validation_counts: plan.validation.counts,
    issue_summary: issueSummary(plan.validation.issues),
    metadata: {
      season: plan.release.season,
      releaseYear: plan.release.releaseYear,
      league: plan.release.league,
      ingestRevision: STAGED_INGEST_REVISION,
      stagedWriter: true,
      normalizedPlanSidecar: true,
    },
  };
}

async function upsertCatalog(plan: ChecklistImportPlan, status: string) {
  const { error } = await serviceClient()
    .from("checklist_source_catalog")
    .upsert(catalogValues(plan, status), { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

function buildArtifact(sourceUrl: string, content: string): ChecklistSourceArtifact {
  assertUpperDeckUrl(sourceUrl);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < 1_000) throw new Error("Upper Deck checklist HTML is incomplete.");
  if (bytes > MAX_UPPER_DECK_HTML_BYTES) throw new Error("Upper Deck checklist HTML exceeds the staged ingest limit.");
  const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1) || "checklist";
  return {
    sourceUrl,
    originalFilename: `${slug}.html`,
    mimeType: "text/html",
    content,
    retrievedAt: new Date().toISOString(),
    authority: "official_manufacturer",
    redistributionAllowed: false,
  };
}

async function parseValidatedArtifact(artifact: ChecklistSourceArtifact) {
  const parsed = await importChecklistArtifact({ artifact, validateOnly: true });
  const errors = parsed.plan.validation.issues.filter((issue) => issue.severity === "error");
  return { ...parsed, errors };
}

function planObjectPath(plan: ChecklistImportPlan) {
  return `${plan.source.storage.objectPath}${PLAN_SUFFIX}`;
}

async function archiveSourceAndPlan(artifact: ChecklistSourceArtifact, plan: ChecklistImportPlan) {
  const supabase = serviceClient();
  const archiveContent = artifact.archiveContent ?? artifact.content;
  const sourceBytes = typeof archiveContent === "string"
    ? Buffer.from(archiveContent, "utf8")
    : Buffer.from(archiveContent);
  const planBytes = Buffer.from(JSON.stringify(plan), "utf8");
  if (planBytes.byteLength > MAX_NORMALIZED_PLAN_BYTES) {
    throw new Error("Normalized Checklist Registry plan exceeds the private staging limit.");
  }

  const sourceUpload = await supabase.storage
    .from(CHECKLIST_SOURCE_BUCKET)
    .upload(plan.source.storage.objectPath, sourceBytes, {
      contentType: plan.source.storage.mimeType,
      upsert: false,
      cacheControl: "0",
    });
  if (sourceUpload.error && !/already exists|duplicate|409/i.test(sourceUpload.error.message || "")) {
    throw new Error(`Could not archive staged checklist source: ${sourceUpload.error.message}`);
  }

  const planUpload = await supabase.storage
    .from(CHECKLIST_SOURCE_BUCKET)
    .upload(planObjectPath(plan), planBytes, {
      contentType: "application/json",
      upsert: true,
      cacheControl: "0",
    });
  if (planUpload.error) {
    throw new Error(`Could not stage normalized checklist plan: ${planUpload.error.message}`);
  }
}

function isChecklistPlan(value: unknown): value is ChecklistImportPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Partial<ChecklistImportPlan>;
  return plan.schema === "tcos.checklist.importPlan.v1"
    && Boolean(plan.source)
    && Boolean(plan.release)
    && Array.isArray(plan.sets)
    && Array.isArray(plan.cards)
    && Array.isArray(plan.parallels)
    && Array.isArray(plan.identities)
    && plan.validation?.status === "passed";
}

async function loadStagedPlan(sourceUrl: string, stage: StagedRequest) {
  assertUpperDeckUrl(sourceUrl);
  if (!validUuid(stage.versionId)) throw new Error("Checklist staged version ID is invalid.");

  const supabase = serviceClient();
  const { data: version, error: versionError } = await supabase
    .from("checklist_versions")
    .select("source_file_id")
    .eq("id", stage.versionId)
    .maybeSingle();
  if (versionError || !version?.source_file_id) {
    throw new Error(`Could not resolve staged checklist version: ${versionError?.message || "missing source file"}`);
  }

  const { data: sourceFile, error: sourceError } = await supabase
    .from("checklist_source_files")
    .select("source_url,storage_bucket,storage_object_path")
    .eq("id", version.source_file_id)
    .maybeSingle();
  if (sourceError || !sourceFile?.storage_object_path || !sourceFile.storage_bucket) {
    throw new Error(`Could not resolve staged checklist source: ${sourceError?.message || "missing archive"}`);
  }
  if (sourceFile.source_url !== sourceUrl) {
    throw new Error("Checklist staged source URL does not match the prepared version.");
  }
  if (sourceFile.storage_bucket !== CHECKLIST_SOURCE_BUCKET) {
    throw new Error("Checklist normalized plan is not in the approved private Registry bucket.");
  }

  const { data: planBlob, error: planError } = await supabase.storage
    .from(CHECKLIST_SOURCE_BUCKET)
    .download(`${sourceFile.storage_object_path}${PLAN_SUFFIX}`);
  if (planError || !planBlob) {
    throw new Error(`Could not load normalized checklist plan: ${planError?.message || "missing private plan"}`);
  }
  if (planBlob.size > MAX_NORMALIZED_PLAN_BYTES) {
    throw new Error("Normalized Checklist Registry plan exceeds the private staging limit.");
  }

  const parsed = JSON.parse(await planBlob.text()) as unknown;
  if (!isChecklistPlan(parsed)) throw new Error("Private staged checklist plan is invalid.");
  if (parsed.source.sourceUrl !== sourceUrl) throw new Error("Private staged checklist plan source URL changed.");
  if (parsed.source.storage.sha256 !== stage.sourceSha256) throw new Error("Private staged checklist plan digest changed.");
  if (parsed.validation.issues.some((issue) => issue.severity === "error")) {
    throw new Error("Private staged checklist plan no longer satisfies validation.");
  }
  return parsed;
}

function scaffoldPlan(plan: ChecklistImportPlan): ChecklistImportPlan {
  return {
    ...plan,
    sets: [],
    cards: [],
    parallels: [],
    identities: [],
  };
}

async function beginImport(artifact: ChecklistSourceArtifact, plan: ChecklistImportPlan) {
  await archiveSourceAndPlan(artifact, plan);
  const storage = plan.source.storage;
  const { data, error } = await serviceClient().rpc("tcos_begin_checklist_import_plan", {
    p_plan: scaffoldPlan(plan),
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });
  if (error) throw new Error(`Checklist Registry staged prepare failed: ${error.message}`);
  return data as Record<string, unknown>;
}

function rowsForKind(plan: ChecklistImportPlan, kind: StagedKind) {
  if (kind === "sets") return plan.sets;
  if (kind === "cards") return plan.cards;
  if (kind === "parallels") return plan.parallels;
  return plan.identities;
}

function firstNormalStage(plan: ChecklistImportPlan, versionId: string, sourceSha256: string): StagedRequest {
  for (const kind of ["sets", "cards", "parallels", "identities"] as StagedKind[]) {
    if (rowsForKind(plan, kind).length) {
      return { phase: "append", versionId, sourceSha256, kind, offset: 0 };
    }
  }
  return { phase: "finalize", versionId, sourceSha256 };
}

function stageAfterChunk(plan: ChecklistImportPlan, stage: AppendStage, nextOffset: number): StagedRequest {
  const total = rowsForKind(plan, stage.kind).length;
  if (nextOffset < total) return { ...stage, offset: nextOffset };
  if (stage.identityRepair) {
    return {
      phase: "finalize",
      versionId: stage.versionId,
      sourceSha256: stage.sourceSha256,
      identityRepair: true,
    };
  }

  const order: StagedKind[] = ["sets", "cards", "parallels", "identities"];
  const current = order.indexOf(stage.kind);
  for (const kind of order.slice(current + 1)) {
    if (rowsForKind(plan, kind).length) {
      return {
        phase: "append",
        versionId: stage.versionId,
        sourceSha256: stage.sourceSha256,
        kind,
        offset: 0,
      };
    }
  }
  return { phase: "finalize", versionId: stage.versionId, sourceSha256: stage.sourceSha256 };
}

async function appendChunk(plan: ChecklistImportPlan, stage: AppendStage) {
  if (!validUuid(stage.versionId)) throw new Error("Checklist staged version ID is invalid.");
  if (!Number.isInteger(stage.offset) || stage.offset < 0) throw new Error("Checklist staged offset is invalid.");
  const rows = rowsForKind(plan, stage.kind);
  const size = CHUNK_SIZES[stage.kind];
  const chunk = rows.slice(stage.offset, stage.offset + size);
  if (!chunk.length) {
    return { persistence: { ok: true, empty: true }, next: stageAfterChunk(plan, stage, rows.length) };
  }

  if (stage.identityRepair) {
    if (stage.kind !== "identities") throw new Error("Checklist identity repair may only append identity chunks.");
    const { data, error } = await serviceClient().rpc("tcos_repair_checklist_identity_chunk", {
      p_version_id: stage.versionId,
      p_identities: chunk,
    });
    if (error) throw new Error(`Checklist Registry identity repair chunk failed: ${error.message}`);
    return { persistence: data, next: stageAfterChunk(plan, stage, stage.offset + chunk.length) };
  }

  const { data, error } = await serviceClient().rpc("tcos_append_checklist_import_chunk", {
    p_version_id: stage.versionId,
    p_sets: stage.kind === "sets" ? chunk : [],
    p_cards: stage.kind === "cards" ? chunk : [],
    p_parallels: stage.kind === "parallels" ? chunk : [],
    p_identities: stage.kind === "identities" ? chunk : [],
  });
  if (error) throw new Error(`Checklist Registry staged ${stage.kind} chunk failed: ${error.message}`);
  return { persistence: data, next: stageAfterChunk(plan, stage, stage.offset + chunk.length) };
}

async function finalizeImport(plan: ChecklistImportPlan, stage: FinalizeStage) {
  const counts = plan.validation.counts;
  if (stage.identityRepair) {
    const { data, error } = await serviceClient().rpc("tcos_finalize_checklist_identity_repair", {
      p_version_id: stage.versionId,
      p_expected_sets: counts.sets,
      p_expected_cards: counts.cards,
      p_expected_parallels: counts.parallels,
      p_expected_identities: counts.identities,
    });
    if (error) throw new Error(`Checklist Registry identity repair finalize failed: ${error.message}`);
    return data as Record<string, unknown>;
  }

  const { data, error } = await serviceClient().rpc("tcos_finalize_checklist_import_plan", {
    p_version_id: stage.versionId,
    p_expected_sets: counts.sets,
    p_expected_cards: counts.cards,
    p_expected_parallels: counts.parallels,
    p_expected_identities: counts.identities,
    p_validation_issues: plan.validation.issues,
  });
  if (error) throw new Error(`Checklist Registry staged finalize failed: ${error.message}`);
  const result = data as Record<string, unknown>;
  if (result.ok !== true) {
    throw new Error(`Checklist Registry staged finalize reported incomplete counts: ${JSON.stringify(result).slice(0, 800)}`);
  }
  return result;
}

async function processUpperDeck(payload: UpperDeckPayload) {
  assertUpperDeckUrl(payload.sourceUrl);

  if (!payload.stage) {
    if (typeof payload.content !== "string") throw new Error("Upper Deck staged prepare requires source HTML.");
    const artifact = buildArtifact(payload.sourceUrl, payload.content);
    const parsed = await parseValidatedArtifact(artifact);
    const plan = parsed.plan;
    const name = releaseName(plan);

    if (!parsed.ok || parsed.errors.length) {
      await upsertCatalog(plan, "quarantined");
      return { sourceUrl: payload.sourceUrl, status: "quarantined", release: name, errors: issueSummary(parsed.errors) };
    }
    if (!payload.autoImport) {
      await upsertCatalog(plan, "validated");
      return { sourceUrl: payload.sourceUrl, status: "validated", release: name, counts: plan.validation.counts };
    }

    const persistence = await beginImport(artifact, plan);
    const versionId = typeof persistence.versionId === "string" ? persistence.versionId : "";
    if (!validUuid(versionId)) throw new Error("Checklist Registry staged prepare did not return a valid version ID.");

    if (persistence.complete === true) {
      await upsertCatalog(plan, "imported");
      return {
        sourceUrl: payload.sourceUrl,
        status: "imported",
        unchanged: persistence.idempotent === true,
        release: name,
        counts: plan.validation.counts,
        persistence,
      };
    }

    await upsertCatalog(plan, "validated");
    const sourceSha256 = plan.source.storage.sha256;
    const next: StagedRequest = persistence.identityRepair === true
      ? { phase: "append", versionId, sourceSha256, kind: "identities", offset: 0, identityRepair: true }
      : firstNormalStage(plan, versionId, sourceSha256);

    return {
      sourceUrl: payload.sourceUrl,
      status: "importing",
      staged: true,
      release: name,
      counts: plan.validation.counts,
      persistence,
      next,
    };
  }

  const plan = await loadStagedPlan(payload.sourceUrl, payload.stage);
  const name = releaseName(plan);

  if (payload.stage.phase === "append") {
    const appended = await appendChunk(plan, payload.stage);
    return {
      sourceUrl: payload.sourceUrl,
      status: "importing",
      staged: true,
      release: name,
      counts: plan.validation.counts,
      persistence: appended.persistence,
      next: appended.next,
    };
  }

  const persistence = await finalizeImport(plan, payload.stage);
  await upsertCatalog(plan, "imported");
  return {
    sourceUrl: payload.sourceUrl,
    status: "imported",
    release: name,
    counts: plan.validation.counts,
    persistence,
  };
}

export async function POST(request: Request) {
  try {
    const claims = await authenticateChecklistDiscoveryAction(request);
    if (claims.workflow_ref !== UPPER_DECK_WORKFLOW) {
      throw new Error("Workflow is not allowed to ingest Upper Deck sources.");
    }
    const payload = (await request.json()) as UpperDeckPayload;
    if (payload.operation !== "upper_deck_source") {
      return Response.json({ ok: false, message: "Unsupported staged checklist operation." }, { status: 400 });
    }
    return Response.json({ ok: true, result: await processUpperDeck(payload) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checklist staged ingest failed.";
    const unauthorized = /authorization|OIDC|workflow|repository|issuer|audience|ref mismatch|event is not trusted/i.test(message);
    console.error("[checklist-staged-plan-action]", message);
    return Response.json(
      { ok: false, message: unauthorized ? "Checklist discovery authorization failed." : message },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
