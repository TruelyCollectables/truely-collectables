import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { importChecklistArtifact } from "@/src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "@/src/lib/checklist-registry/source-adapter";
import { authenticateChecklistDiscoveryAction } from "@/src/lib/github-actions-checklist-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REPOSITORY = "TruelyCollectables/truely-collectables";
const UPPER_DECK_WORKFLOW = `${REPOSITORY}/.github/workflows/automatic-checklist-discovery.yml@refs/heads/main`;
const TOPPS_WORKFLOW = `${REPOSITORY}/.github/workflows/automatic-topps-baseball-checklist-discovery.yml@refs/heads/main`;
const MAX_UPPER_DECK_HTML_BYTES = 8 * 1024 * 1024;
const MAX_SELECTION_CANDIDATES = 2_000;
const MAX_UPPER_DECK_SELECTION = 60;
const MAX_TOPPS_SELECTION = 40;

type UpperDeckSelectionPayload = {
  operation: "upper_deck_select_sources";
  sourceUrls: string[];
  limit?: number;
};

type UpperDeckPayload = {
  operation: "upper_deck_source";
  sourceUrl: string;
  content: string;
  autoImport?: boolean;
};

type ToppsProductCandidate = {
  url: string;
  title: string;
};

type ToppsSelectionPayload = {
  operation: "topps_select_products";
  productPages: ToppsProductCandidate[];
  limit?: number;
};

type ToppsCatalogPayload = {
  operation: "topps_catalog_upsert";
  sourceUrl: string;
  sourceSha256: string;
  releaseName: string;
  status: "discovered" | "quarantined";
  checkedAt: string;
  issueSummary: Array<{ code: string; severity: string; message: string }>;
  metadata: Record<string, unknown>;
};

type ActionPayload =
  | UpperDeckSelectionPayload
  | UpperDeckPayload
  | ToppsSelectionPayload
  | ToppsCatalogPayload;

type CatalogSelectionRow = {
  source_url: string | null;
  last_checked_at: string | null;
  metadata?: unknown;
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

function issueSummary(values: Array<{ code: string; severity: string; message: string }>) {
  return values.slice(0, 50).map((value) => ({
    code: String(value.code || "unknown").slice(0, 100),
    severity: String(value.severity || "error").slice(0, 20),
    message: String(value.message || "").slice(0, 500),
  }));
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value as number)));
}

function checkedTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function upsertCatalog(values: Record<string, unknown>) {
  const { error } = await serviceClient()
    .from("checklist_source_catalog")
    .upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

async function catalogSelectionRows(manufacturer: string, sport?: string) {
  const db = serviceClient();
  const rows: CatalogSelectionRow[] = [];
  const pageSize = 1_000;

  for (let start = 0; start < 10_000; start += pageSize) {
    let query = db
      .from("checklist_source_catalog")
      .select("source_url,last_checked_at,metadata")
      .eq("manufacturer", manufacturer)
      .range(start, start + pageSize - 1);
    if (sport) query = query.eq("sport", sport);
    const { data, error } = await query;
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    const page = (data || []) as CatalogSelectionRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function assertUpperDeckUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)upperdeck\.com$/i.test(url.hostname)) {
    throw new Error("Upper Deck checklist source URL is not trusted.");
  }
}

function assertToppsProductUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/^(?:www\.)?topps\.com$/i.test(url.hostname) ||
    !/^\/(?:pages|products)\//i.test(url.pathname)
  ) {
    throw new Error("Topps product page URL is not trusted.");
  }
}

async function selectUpperDeckSources(payload: UpperDeckSelectionPayload) {
  if (!Array.isArray(payload.sourceUrls) || payload.sourceUrls.length === 0) return { sourceUrls: [] };
  const unique = [...new Set(payload.sourceUrls.slice(0, MAX_SELECTION_CANDIDATES))];
  unique.forEach(assertUpperDeckUrl);
  const limit = boundedLimit(payload.limit, MAX_UPPER_DECK_SELECTION, MAX_UPPER_DECK_SELECTION);
  const rows = await catalogSelectionRows("Upper Deck");
  const lastChecked = new Map<string, number>();
  for (const row of rows) {
    if (row.source_url) lastChecked.set(row.source_url, checkedTime(row.last_checked_at));
  }

  const ranked = unique
    .map((sourceUrl, index) => ({
      sourceUrl,
      index,
      seen: lastChecked.has(sourceUrl),
      lastCheckedAt: lastChecked.get(sourceUrl) ?? 0,
    }))
    .sort((left, right) => {
      if (left.seen !== right.seen) return left.seen ? 1 : -1;
      if (left.lastCheckedAt !== right.lastCheckedAt) return left.lastCheckedAt - right.lastCheckedAt;
      return left.index - right.index;
    });

  return {
    sourceUrls: ranked.slice(0, limit).map((candidate) => candidate.sourceUrl),
    candidateCount: unique.length,
    unseenCount: ranked.filter((candidate) => !candidate.seen).length,
  };
}

async function processUpperDeck(payload: UpperDeckPayload) {
  assertUpperDeckUrl(payload.sourceUrl);
  if (typeof payload.content !== "string" || payload.content.length < 1_000) {
    throw new Error("Upper Deck checklist HTML is incomplete.");
  }
  if (Buffer.byteLength(payload.content, "utf8") > MAX_UPPER_DECK_HTML_BYTES) {
    throw new Error("Upper Deck checklist HTML exceeds the ingest limit.");
  }

  const db = serviceClient();
  const checkedAt = new Date().toISOString();
  const sourceSha256 = sha256(payload.content);
  const { data: existing, error } = await db
    .from("checklist_source_catalog")
    .select("status,source_sha256")
    .eq("source_url", payload.sourceUrl)
    .maybeSingle();
  if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);

  if (["imported", "unchanged"].includes(existing?.status || "") && existing?.source_sha256 === sourceSha256) {
    const status = existing?.status === "imported" ? "imported" : "unchanged";
    await upsertCatalog({
      manufacturer: "Upper Deck",
      source_url: payload.sourceUrl,
      source_sha256: sourceSha256,
      status,
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
    });
    return { sourceUrl: payload.sourceUrl, status, sourceSha256, unchanged: true };
  }

  const slug = new URL(payload.sourceUrl).pathname.split("/").filter(Boolean).at(-1) || "checklist";
  const artifact: ChecklistSourceArtifact = {
    sourceUrl: payload.sourceUrl,
    originalFilename: `${slug}.html`,
    mimeType: "text/html",
    content: payload.content,
    retrievedAt: checkedAt,
    authority: "official_manufacturer",
    redistributionAllowed: false,
  };

  const validation = await importChecklistArtifact({ artifact, validateOnly: true });
  const validationErrors = validation.plan.validation.issues.filter((value) => value.severity === "error");
  const releaseName = [validation.plan.release.season || validation.plan.release.releaseYear, validation.plan.release.product]
    .filter(Boolean)
    .join(" ");
  const common = {
    manufacturer: validation.plan.release.manufacturer,
    sport: validation.plan.release.sport,
    source_url: payload.sourceUrl,
    source_sha256: sourceSha256,
    release_slug: validation.plan.release.releaseSlug,
    release_name: releaseName,
    adapter_id: validation.adapter.id,
    adapter_version: validation.adapter.version,
    last_seen_at: checkedAt,
    last_checked_at: checkedAt,
    validation_counts: validation.plan.validation.counts,
    issue_summary: issueSummary(validation.plan.validation.issues),
    metadata: {
      season: validation.plan.release.season,
      releaseYear: validation.plan.release.releaseYear,
      league: validation.plan.release.league,
    },
  };

  if (!validation.ok || validationErrors.length) {
    await upsertCatalog({ ...common, status: "quarantined" });
    return {
      sourceUrl: payload.sourceUrl,
      status: "quarantined",
      release: releaseName,
      errors: issueSummary(validationErrors),
    };
  }

  if (!payload.autoImport) {
    await upsertCatalog({ ...common, status: "validated" });
    return {
      sourceUrl: payload.sourceUrl,
      status: "validated",
      release: releaseName,
      counts: validation.plan.validation.counts,
    };
  }

  const imported = await importChecklistArtifact({ artifact });
  if (!imported.ok || imported.validatedOnly) {
    throw new Error("Validated checklist did not complete Registry persistence.");
  }
  await upsertCatalog({ ...common, status: "imported", imported_at: checkedAt });
  return {
    sourceUrl: payload.sourceUrl,
    status: "imported",
    release: releaseName,
    counts: imported.plan.validation.counts,
    persistence: imported.persistence,
  };
}

async function selectToppsProducts(payload: ToppsSelectionPayload) {
  if (!Array.isArray(payload.productPages) || payload.productPages.length === 0) return { productPages: [] };
  const unique = new Map<string, ToppsProductCandidate>();
  for (const candidate of payload.productPages.slice(0, MAX_SELECTION_CANDIDATES)) {
    if (!candidate || typeof candidate.url !== "string" || typeof candidate.title !== "string") {
      throw new Error("Topps product candidate is invalid.");
    }
    assertToppsProductUrl(candidate.url);
    unique.set(candidate.url, { url: candidate.url, title: candidate.title.slice(0, 500) });
  }
  const candidates = [...unique.values()];
  const limit = boundedLimit(payload.limit, MAX_TOPPS_SELECTION, MAX_TOPPS_SELECTION);
  const rows = await catalogSelectionRows("Topps", "Baseball");
  const lastChecked = new Map<string, number>();

  for (const row of rows) {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : null;
    const productPageUrl = typeof metadata?.productPageUrl === "string"
      ? metadata.productPageUrl
      : null;
    if (!productPageUrl) continue;
    const timestamp = checkedTime(row.last_checked_at);
    lastChecked.set(productPageUrl, Math.max(lastChecked.get(productPageUrl) || 0, timestamp));
  }

  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      seen: lastChecked.has(candidate.url),
      lastCheckedAt: lastChecked.get(candidate.url) ?? 0,
    }))
    .sort((left, right) => {
      if (left.seen !== right.seen) return left.seen ? 1 : -1;
      if (left.lastCheckedAt !== right.lastCheckedAt) return left.lastCheckedAt - right.lastCheckedAt;
      return left.index - right.index;
    });

  return {
    productPages: ranked.slice(0, limit).map((candidate) => candidate.candidate),
    candidateCount: candidates.length,
    unseenCount: ranked.filter((candidate) => !candidate.seen).length,
  };
}

async function processTopps(payload: ToppsCatalogPayload) {
  const source = new URL(payload.sourceUrl);
  if (source.protocol !== "https:") throw new Error("Topps source URL must use HTTPS.");
  if (!/^[a-f0-9]{64}$/i.test(payload.sourceSha256)) throw new Error("Topps source digest is invalid.");
  if (!payload.releaseName || payload.releaseName.length > 500) throw new Error("Topps release name is invalid.");
  if (!Number.isFinite(Date.parse(payload.checkedAt))) throw new Error("Topps checkedAt timestamp is invalid.");

  await upsertCatalog({
    manufacturer: "Topps",
    sport: "Baseball",
    source_url: payload.sourceUrl,
    source_sha256: payload.sourceSha256,
    release_name: payload.releaseName,
    status: payload.status,
    last_seen_at: payload.checkedAt,
    last_checked_at: payload.checkedAt,
    issue_summary: issueSummary(payload.issueSummary || []),
    metadata: payload.metadata || {},
  });
  return { sourceUrl: payload.sourceUrl, status: payload.status, sourceSha256: payload.sourceSha256 };
}

export async function POST(request: Request) {
  try {
    const claims = await authenticateChecklistDiscoveryAction(request);
    const payload = (await request.json()) as ActionPayload;

    if (payload.operation === "upper_deck_select_sources") {
      if (claims.workflow_ref !== UPPER_DECK_WORKFLOW) throw new Error("Workflow is not allowed to select Upper Deck sources.");
      return Response.json({ ok: true, result: await selectUpperDeckSources(payload) });
    }
    if (payload.operation === "upper_deck_source") {
      if (claims.workflow_ref !== UPPER_DECK_WORKFLOW) throw new Error("Workflow is not allowed to ingest Upper Deck sources.");
      return Response.json({ ok: true, result: await processUpperDeck(payload) });
    }
    if (payload.operation === "topps_select_products") {
      if (claims.workflow_ref !== TOPPS_WORKFLOW) throw new Error("Workflow is not allowed to select Topps products.");
      return Response.json({ ok: true, result: await selectToppsProducts(payload) });
    }
    if (payload.operation === "topps_catalog_upsert") {
      if (claims.workflow_ref !== TOPPS_WORKFLOW) throw new Error("Workflow is not allowed to update Topps discovery records.");
      return Response.json({ ok: true, result: await processTopps(payload) });
    }
    return Response.json({ ok: false, message: "Unsupported checklist discovery operation." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checklist discovery ingest failed.";
    const unauthorized = /authorization|OIDC|workflow|repository|issuer|audience|ref mismatch|event is not trusted/i.test(message);
    console.error("[checklist-discovery-action]", message);
    return Response.json(
      { ok: false, message: unauthorized ? "Checklist discovery authorization failed." : message },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
