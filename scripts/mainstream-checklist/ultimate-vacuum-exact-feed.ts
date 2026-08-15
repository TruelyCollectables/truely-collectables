import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { importChecklistArtifact } from "../../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact, ChecklistSourceAuthority } from "../../src/lib/checklist-registry/source-adapter";

const INPUT = resolve(process.cwd(), process.env.VACUUM_FEED_INPUT || "tmp/ultimate-vacuum-feed.json");
const OUTPUT = resolve(process.cwd(), process.env.VACUUM_FEED_OUTPUT || "tmp/ultimate-vacuum-feed-receipt.json");
const APPLY = process.env.VACUUM_FEED_APPLY === "true";
const MAX_CANDIDATES = Math.max(1, Number(process.env.VACUUM_FEED_MAX_CANDIDATES || 150));
const MINIMUM_CARD_ROWS = Math.max(25, Number(process.env.VACUUM_FEED_MINIMUM_CARD_ROWS || 25));
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.VACUUM_FEED_FETCH_TIMEOUT_MS || 30_000));

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Vacuum exact feed requires Production Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function slug(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;|&#038;|&#38;/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function yearOf(value: unknown) {
  const match = String(value || "").match(/(?:19|20)\d{2}/);
  return match ? match[0] : "";
}

function contentTypeFromUrl(url: string) {
  const e = extname(new URL(url).pathname).toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".xls") return "application/vnd.ms-excel";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".csv") return "text/csv";
  return "text/html";
}

function authorityFor(candidate: any): ChecklistSourceAuthority {
  const id = String(candidate?.sourceId || "");
  if (/topps|upper-deck|panini-official/i.test(id)) return "official_manufacturer";
  return "approved_reference_dataset";
}

function eligible(candidate: any) {
  const mode = String(candidate?.sourceMode || "");
  const kind = String(candidate?.kind || "");
  const score = Number(candidate?.reputationScore || 0);
  if (mode.startsWith("lead-only")) return false;
  if (!["asset", "checklist-page"].includes(kind)) return false;
  if (score < 75) return false;
  try {
    const host = new URL(String(candidate?.url || "")).hostname.toLowerCase();
    if (["beckett.com", "www.beckett.com"].includes(host)) return false;
  } catch { return false; }
  return true;
}

async function fetchArtifact(candidate: any): Promise<ChecklistSourceArtifact> {
  const url = String(candidate.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.5" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 128) throw new Error(`source too small (${bytes.byteLength} bytes)`);
    const mimeType = (response.headers.get("content-type") || contentTypeFromUrl(url)).split(";")[0].trim();
    const filename = basename(new URL(response.url || url).pathname) || `checklist${extname(new URL(url).pathname) || ".html"}`;
    const isText = /^(text\/|application\/(?:json|xml|xhtml\+xml))/i.test(mimeType) || /\.html?$/i.test(filename);
    const content = isText ? new TextDecoder().decode(bytes) : bytes;
    return {
      sourceUrl: response.url || url,
      originalFilename: filename,
      mimeType,
      content,
      retrievedAt: new Date().toISOString(),
      authority: authorityFor(candidate),
      redistributionAllowed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadMasterKeys(db: ReturnType<typeof dbClient>) {
  const rows: any[] = [];
  for (let start = 0; start < 12_000; start += 1000) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("status,source_url,metadata")
      .range(start, start + 999);
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const map = new Map<string, { imported: boolean; rows: number }>();
  for (const row of rows) {
    const key = String(row?.metadata?.masterArchiveExactSetKey || row?.metadata?.exactSetKey || "").toLowerCase();
    if (!key || key.split("|").length !== 4) continue;
    const current = map.get(key) || { imported: false, rows: 0 };
    current.imported ||= row.status === "imported";
    current.rows += 1;
    map.set(key, current);
  }
  return map;
}

function matchExactSet(plan: any, master: Map<string, { imported: boolean; rows: number }>) {
  const sport = slug(plan.release?.sport);
  const season = slug(plan.release?.season || plan.release?.releaseYear);
  const seasonYear = yearOf(plan.release?.season || plan.release?.releaseYear);
  const maker = slug(plan.release?.manufacturer);
  const brand = slug(plan.release?.brand);
  const product = slug(plan.release?.product);
  if (!sport || !season || !product) return { match: null as string | null, reason: "release_identity_incomplete", candidates: [] as any[] };

  const scored: Array<{ key: string; score: number }> = [];
  for (const key of master.keys()) {
    const [ksport, kseason, kmaker, kproduct] = key.split("|");
    if (slug(ksport) !== sport) continue;
    const keyYear = yearOf(kseason);
    if (!(slug(kseason) === season || (seasonYear && keyYear === seasonYear))) continue;

    let score = 0;
    const kp = slug(kproduct);
    const km = slug(kmaker);
    if (kp === product) score += 10;
    else if (kp && product && (kp.includes(product) || product.includes(kp))) score += 5;
    else continue;

    if (km === maker) score += 5;
    if (brand && km === brand) score += 4;
    if (maker && (kp.startsWith(maker + "-") || product.startsWith(km + "-"))) score += 1;
    if (slug(kseason) === season) score += 3;
    scored.push({ key, score });
  }

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  if (!scored.length) return { match: null, reason: "no_master_exact_set_match", candidates: [] };
  const best = scored[0].score;
  const bestRows = scored.filter((value) => value.score === best);
  if (best < 13) return { match: null, reason: "weak_master_exact_set_match", candidates: scored.slice(0, 5) };
  if (bestRows.length !== 1) return { match: null, reason: "ambiguous_master_exact_set_match", candidates: bestRows.slice(0, 5) };
  return { match: bestRows[0].key, reason: null, candidates: scored.slice(0, 5) };
}

async function upsertCatalog(db: ReturnType<typeof dbClient>, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update source catalog: ${error.message}`);
}

function issueSummary(plan: any) {
  return (plan?.validation?.issues || []).slice(0, 50).map((value: any) => ({
    code: String(value.code || "validation_issue"),
    severity: String(value.severity || "error"),
    message: String(value.message || "").slice(0, 500),
  }));
}

async function main() {
  const input = JSON.parse(readFileSync(INPUT, "utf8"));
  const ranked = Array.isArray(input) ? input : (input.ranked || input.candidates || []);
  const candidates = ranked.filter(eligible).slice(0, MAX_CANDIDATES);
  const db = dbClient();
  const master = await loadMasterKeys(db);
  const startedAt = new Date().toISOString();
  const results: any[] = [];

  for (const candidate of candidates) {
    const checkedAt = new Date().toISOString();
    const sourceUrl = String(candidate.url);
    try {
      const artifact = await fetchArtifact(candidate);
      const sourceBytes = typeof artifact.content === "string" ? Buffer.from(artifact.content, "utf8") : Buffer.from(artifact.content);
      const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
      const first = await importChecklistArtifact({ artifact, validateOnly: true });
      const plan = first.plan;
      const counts = plan.validation.counts;
      if (!first.ok || plan.validation.status !== "passed" || Number(counts.cards || 0) < MINIMUM_CARD_ROWS) {
        await upsertCatalog(db, {
          manufacturer: plan.release.manufacturer,
          sport: plan.release.sport,
          source_url: sourceUrl,
          source_sha256: sourceSha256,
          release_slug: plan.release.releaseSlug,
          release_name: `${plan.release.season || plan.release.releaseYear || ""} ${plan.release.product}`.trim(),
          adapter_id: first.adapter.id,
          adapter_version: first.adapter.version,
          status: "quarantined",
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          validation_counts: counts,
          issue_summary: issueSummary(plan),
          metadata: { vacuumSourceId: candidate.sourceId || null, vacuumReputationScore: candidate.reputationScore || null, vacuumExactFeed: true },
        });
        results.push({ sourceUrl, status: "quarantined", reason: "registry_validation_failed", counts });
        continue;
      }

      const matched = matchExactSet(plan, master);
      if (!matched.match) {
        await upsertCatalog(db, {
          manufacturer: plan.release.manufacturer,
          sport: plan.release.sport,
          source_url: sourceUrl,
          source_sha256: sourceSha256,
          release_slug: plan.release.releaseSlug,
          release_name: `${plan.release.season || plan.release.releaseYear || ""} ${plan.release.product}`.trim(),
          adapter_id: first.adapter.id,
          adapter_version: first.adapter.version,
          status: "quarantined",
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          validation_counts: counts,
          issue_summary: [{ code: matched.reason, severity: "error", message: `Vacuum candidate could not resolve uniquely to a known exact set. Top candidates: ${matched.candidates.map((value: any) => value.key).join(", ").slice(0, 400)}` }],
          metadata: { vacuumSourceId: candidate.sourceId || null, vacuumReputationScore: candidate.reputationScore || null, vacuumExactFeed: true },
        });
        results.push({ sourceUrl, status: "quarantined", reason: matched.reason, topMatches: matched.candidates });
        continue;
      }

      const exactSetKey = matched.match;
      const masterState = master.get(exactSetKey);
      if (masterState?.imported) {
        results.push({ sourceUrl, exactSetKey, status: "already_imported" });
        continue;
      }

      const [sport, season, manufacturer, product] = exactSetKey.split("|");
      const targetedArtifact: ChecklistSourceArtifact = {
        ...artifact,
        targetContext: { targetKey: exactSetKey, sport, season, year: yearOf(season), manufacturer, product },
      };
      const second = await importChecklistArtifact({ artifact: targetedArtifact, validateOnly: !APPLY });
      if (!second.ok || second.plan.validation.status !== "passed" || Number(second.plan.validation.counts.cards || 0) < MINIMUM_CARD_ROWS) {
        await upsertCatalog(db, {
          manufacturer: second.plan.release.manufacturer,
          sport: second.plan.release.sport,
          source_url: sourceUrl,
          source_sha256: sourceSha256,
          release_slug: second.plan.release.releaseSlug,
          release_name: `${second.plan.release.season || second.plan.release.releaseYear || ""} ${second.plan.release.product}`.trim(),
          adapter_id: second.adapter.id,
          adapter_version: second.adapter.version,
          status: "quarantined",
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          validation_counts: second.plan.validation.counts,
          issue_summary: issueSummary(second.plan),
          metadata: { masterArchiveExactSetKey: exactSetKey, vacuumSourceId: candidate.sourceId || null, vacuumReputationScore: candidate.reputationScore || null, vacuumExactFeed: true },
        });
        results.push({ sourceUrl, exactSetKey, status: "quarantined", reason: "targeted_validation_failed" });
        continue;
      }

      const status = APPLY && !second.validatedOnly ? "imported" : "validated";
      await upsertCatalog(db, {
        manufacturer: second.plan.release.manufacturer,
        sport: second.plan.release.sport,
        source_url: sourceUrl,
        source_sha256: sourceSha256,
        release_slug: second.plan.release.releaseSlug,
        release_name: `${second.plan.release.season || second.plan.release.releaseYear || ""} ${second.plan.release.product}`.trim(),
        adapter_id: second.adapter.id,
        adapter_version: second.adapter.version,
        status,
        imported_at: status === "imported" ? checkedAt : null,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: second.plan.validation.counts,
        issue_summary: issueSummary(second.plan),
        metadata: { masterArchiveExactSetKey: exactSetKey, vacuumSourceId: candidate.sourceId || null, vacuumReputationScore: candidate.reputationScore || null, vacuumExactFeed: true },
      });
      if (status === "imported") master.set(exactSetKey, { imported: true, rows: (masterState?.rows || 0) + 1 });
      results.push({ sourceUrl, exactSetKey, status, counts: second.plan.validation.counts, persistence: second.persistence, netNew: status === "imported" && (second.persistence as any)?.idempotent !== true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      results.push({ sourceUrl, status: "failed", message: message.slice(0, 500) });
    }
  }

  const statuses: Record<string, number> = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] || 0) + 1;
  const receipt = {
    schema: "tcos.checklist.ultimateVacuumExactFeedReceipt.v1",
    mode: APPLY ? "apply" : "validate",
    startedAt,
    completedAt: new Date().toISOString(),
    masterExactSetCount: master.size,
    candidateInputCount: ranked.length,
    eligibleCandidateCount: ranked.filter(eligible).length,
    selectedCount: candidates.length,
    minimumCardRows: MINIMUM_CARD_ROWS,
    statuses,
    netNew: results.filter((value) => value.netNew === true).length,
    results,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ mode: receipt.mode, selectedCount: receipt.selectedCount, statuses: receipt.statuses, netNew: receipt.netNew }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
