import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { importChecklistArtifact } from "@/src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "@/src/lib/checklist-registry/source-adapter";
import { authenticateRequestedWnbaImportAction } from "@/src/lib/github-actions-requested-wnba-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BATCH_ID = "requested-wnba-20260816-v1";
const MAX_COMPRESSED_BYTES = 256 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

const EXPECTED = {
  "2024-Panini-Origins-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2024-panini-origins-wnba", sourcePdfSha256: "71ec2609783950391c317dc7f8a991e09f5b605336cec8a54d215cce1af61231" },
  "2024-Panini-Prizm-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2024-panini-prizm-wnba", sourcePdfSha256: "46024670cd8231bb9f86c93bf77283cf53eda5825810be4edbee956639fb17d8" },
  "2024-Panini-Select-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2024-panini-select-wnba", sourcePdfSha256: "ef7b27f51b2550d902b864b2e1e02feadf834290554ef743905dfa313edd828f" },
  "2025-Donruss-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2025-panini-donruss-wnba", sourcePdfSha256: "db744cf7583c2ba1fa6479440830fa534b874cfb6a5d088b239bb8d74d88b408" },
  "2025-Panini-Impeccable-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2025-panini-impeccable-wnba", sourcePdfSha256: "ee5846c33916fc39238c74bba7f8e97c33eb7aaf0fee44123f98815e82a77a56" },
  "2025-Panini-One-and-One-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2025-panini-one-and-one-wnba", sourcePdfSha256: "d1d7518041898ce0b9db16dc2e06bc7b1daec4ceb691246ab76e4698f89ca595" },
  "2025-Panini-Prizm-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2025-panini-prizm-wnba", sourcePdfSha256: "09f17763198895036746985dae860c3fffa6ae012c48259f010524cb4268e0ad" },
  "2025-Panini-Select-WNBA-Basketball-Cards-Checklist.json": { releaseSlug: "2025-panini-select-wnba", sourcePdfSha256: "fe08ba3c36135812c343c7ecd4f9dab583e3def5cd44928c832cfda6cf8d6150" },
} as const;

type ExpectedFilename = keyof typeof EXPECTED;
type ImportPayload = {
  operation: "requested_wnba_snapshot";
  filename: ExpectedFilename;
  sourcePdfSha256: string;
  compressedSnapshotBase64: string;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Checklist Registry production credentials are unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cleanIssues(values: Array<{ code: string; severity: string; message: string }>) {
  return values.slice(0, 50).map((value) => ({
    code: String(value.code || "unknown").slice(0, 100),
    severity: String(value.severity || "error").slice(0, 20),
    message: String(value.message || "").slice(0, 500),
  }));
}

async function upsertCatalog(values: Record<string, unknown>) {
  const { error } = await serviceClient().from("checklist_source_catalog").upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

async function processSnapshot(payload: ImportPayload) {
  const expected = EXPECTED[payload.filename];
  if (!expected) throw new Error("Requested WNBA snapshot filename is not approved.");
  if (payload.sourcePdfSha256 !== expected.sourcePdfSha256) throw new Error("Requested WNBA source PDF digest mismatch.");
  if (typeof payload.compressedSnapshotBase64 !== "string" || !payload.compressedSnapshotBase64) {
    throw new Error("Requested WNBA snapshot payload is missing.");
  }
  const compressed = Buffer.from(payload.compressedSnapshotBase64, "base64");
  if (!compressed.length || compressed.length > MAX_COMPRESSED_BYTES) throw new Error("Requested WNBA compressed snapshot is invalid.");
  const decoded = brotliDecompressSync(compressed);
  if (!decoded.length || decoded.length > MAX_JSON_BYTES) throw new Error("Requested WNBA snapshot exceeds ingest limits.");
  const snapshot = JSON.parse(decoded.toString("utf8")) as {
    schema?: string;
    scope?: string;
    release?: { manufacturer?: string; sport?: string; league?: string; releaseSlug?: string; product?: string; releaseYear?: string };
  };
  if (snapshot.schema !== "tcos.panini.structuredChecklist.v1" || snapshot.scope !== "full_checklist") {
    throw new Error("Requested WNBA snapshot schema or scope is invalid.");
  }
  if (
    snapshot.release?.manufacturer !== "Panini" ||
    snapshot.release?.sport !== "Basketball" ||
    snapshot.release?.league !== "WNBA" ||
    snapshot.release?.releaseSlug !== expected.releaseSlug
  ) {
    throw new Error("Requested WNBA snapshot release identity mismatch.");
  }

  const content = JSON.stringify(snapshot);
  const sourceSha256 = sha256(content);
  const sourceUrl = `manual://requested-wnba/${expected.releaseSlug}`;
  const db = serviceClient();
  const { data: existing, error: existingError } = await db
    .from("checklist_source_catalog")
    .select("status,source_sha256,validation_counts")
    .eq("source_url", sourceUrl)
    .maybeSingle();
  if (existingError) throw new Error(`Could not read checklist source catalog: ${existingError.message}`);
  if (existing?.status === "imported" && existing?.source_sha256 === sourceSha256) {
    return {
      filename: payload.filename,
      releaseSlug: expected.releaseSlug,
      status: "unchanged",
      sourceSha256,
      counts: existing.validation_counts || null,
    };
  }

  const checkedAt = new Date().toISOString();
  const artifact: ChecklistSourceArtifact = {
    sourceUrl,
    originalFilename: payload.filename,
    mimeType: "application/json",
    content,
    retrievedAt: checkedAt,
    authority: "manual_official_file",
    redistributionAllowed: false,
  };
  const validation = await importChecklistArtifact({ artifact, validateOnly: true });
  const errors = validation.plan.validation.issues.filter((issue) => issue.severity === "error");
  const releaseName = [validation.plan.release.releaseYear, "Panini", validation.plan.release.product, "WNBA"]
    .filter(Boolean)
    .join(" ");
  const common = {
    manufacturer: "Panini",
    sport: "Basketball",
    source_url: sourceUrl,
    source_sha256: sourceSha256,
    release_slug: expected.releaseSlug,
    release_name: releaseName,
    adapter_id: validation.adapter.id,
    adapter_version: validation.adapter.version,
    last_seen_at: checkedAt,
    last_checked_at: checkedAt,
    validation_counts: validation.plan.validation.counts,
    issue_summary: cleanIssues(validation.plan.validation.issues),
    metadata: {
      league: "WNBA",
      sourcePdfSha256: expected.sourcePdfSha256,
      normalizedFilename: payload.filename,
      batchId: BATCH_ID,
    },
  };
  if (!validation.ok || errors.length) {
    await upsertCatalog({ ...common, status: "quarantined" });
    return {
      filename: payload.filename,
      releaseSlug: expected.releaseSlug,
      status: "quarantined",
      counts: validation.plan.validation.counts,
      errors: cleanIssues(errors),
    };
  }

  const imported = await importChecklistArtifact({ artifact });
  if (!imported.ok || imported.validatedOnly) throw new Error("Validated WNBA checklist did not persist to Registry.");
  await upsertCatalog({ ...common, status: "imported", imported_at: checkedAt });
  return {
    filename: payload.filename,
    releaseSlug: expected.releaseSlug,
    status: "imported",
    sourceSha256,
    counts: imported.plan.validation.counts,
    persistence: imported.persistence,
  };
}

export async function POST(request: Request) {
  try {
    await authenticateRequestedWnbaImportAction(request);
    const payload = (await request.json()) as ImportPayload;
    if (payload.operation !== "requested_wnba_snapshot") {
      return Response.json({ ok: false, message: "Unsupported requested WNBA import operation." }, { status: 400 });
    }
    const result = await processSnapshot(payload);
    return Response.json({ ok: result.status === "imported" || result.status === "unchanged", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Requested WNBA import failed.";
    const unauthorized = /authorization|OIDC|workflow|repository|issuer|audience|ref mismatch|event is not trusted/i.test(message);
    console.error("[requested-wnba-import]", message);
    return Response.json({ ok: false, message: unauthorized ? "Requested WNBA import authorization failed." : message }, { status: unauthorized ? 401 : 500 });
  }
}
