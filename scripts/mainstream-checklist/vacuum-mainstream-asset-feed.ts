import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { downloadAndParse } from "./source-tools.mjs";
import {
  assertPlanComplexity,
  buildPlan,
  dbClient,
  limitedIssues,
  persistPlan,
  upsertCatalog,
} from "./registry-tools.mjs";

const INPUT = resolve(process.cwd(), process.env.VACUUM_MAINSTREAM_INPUT || "tmp/conveyor-resolved.json");
const OUTPUT = resolve(process.cwd(), process.env.VACUUM_MAINSTREAM_OUTPUT || "tmp/vacuum-mainstream-receipt.json");
const APPLY = process.env.VACUUM_MAINSTREAM_APPLY === "true";
const MAX = Math.max(1, Number(process.env.VACUUM_MAINSTREAM_MAX || 1200));
const MIN_ROWS = Math.max(25, Number(process.env.VACUUM_MAINSTREAM_MIN_ROWS || 25));
const RPS_CAP = Math.max(0.05, Math.min(0.4, Number(process.env.VACUUM_MAINSTREAM_RPS_CAP || 0.4)));

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const nextHostRequest = new Map<string, number>();

function slug(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&amp;|&#038;|&#38;/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function yearOf(value: unknown) {
  const m = String(value || "").match(/(?:19|20)\d{2}/);
  return m ? m[0] : "";
}

function words(value: unknown) {
  const stop = new Set([
    "card", "cards", "checklist", "checklists", "excel", "spreadsheet", "download", "full", "complete",
    "the", "and", "for", "with", "official", "trading", "box", "hobby", "edition",
  ]);
  return slug(value).split("-").filter((word) => word.length > 1 && !stop.has(word) && !/^(?:19|20)\d{2}$/.test(word));
}

function candidateText(candidate: any) {
  const pieces: string[] = [];
  for (const value of [candidate?.url, candidate?.parentUrl]) {
    try {
      const parsed = new URL(String(value || ""));
      pieces.push(decodeURIComponent(parsed.pathname));
    } catch {}
  }
  return pieces.join(" ");
}

function inferredSport(value: string) {
  const text = slug(value);
  const aliases: Array<[RegExp, string]> = [
    [/\bbaseball\b/, "baseball"],
    [/\bfootball\b/, "football"],
    [/\bbasketball\b|\bwnba\b/, "basketball"],
    [/\bhockey\b|\bnhl\b/, "hockey"],
    [/\bsoccer\b/, "soccer"],
    [/\bwrestling\b|\bwwe\b|\baew\b/, "wrestling"],
    [/\bracing\b|\bnascar\b|\bformula-?1\b|\bf1\b/, "racing"],
    [/\bmma\b|\bufc\b/, "mma"],
    [/\bgolf\b|\bpga\b/, "golf"],
    [/\btennis\b/, "tennis"],
  ];
  for (const [pattern, sport] of aliases) if (pattern.test(text)) return sport;
  return "";
}

type MasterState = { imported: boolean; rows: number };

async function loadMasterState(db: ReturnType<typeof dbClient>) {
  const state = new Map<string, MasterState>();
  for (let start = 0; start < 16000; start += 1000) {
    const { data, error } = await db.from("checklist_source_catalog").select("status,metadata").range(start, start + 999);
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    for (const row of data || []) {
      const key = String((row as any)?.metadata?.masterArchiveExactSetKey || (row as any)?.metadata?.exactSetKey || "").toLowerCase();
      if (!key || key.split("|").length !== 4) continue;
      const current = state.get(key) || { imported: false, rows: 0 };
      current.imported ||= (row as any).status === "imported";
      current.rows += 1;
      state.set(key, current);
    }
    if (!data || data.length < 1000) break;
  }
  return state;
}

function resolveExactSet(candidate: any, master: Map<string, MasterState>) {
  const text = candidateText(candidate);
  const textSlug = slug(text);
  const tokenSet = new Set(words(text));
  const year = yearOf(text);
  const sport = inferredSport(text);
  const scored: Array<{ key: string; score: number; overlap: number }> = [];

  for (const key of master.keys()) {
    const [ksport, kseason, kmaker, kproduct] = key.split("|");
    if (year && yearOf(kseason) !== year) continue;
    if (sport && slug(ksport) !== slug(sport)) continue;

    const productSlug = slug(kproduct);
    const makerSlug = slug(kmaker);
    const productWords = words(kproduct);
    if (!productWords.length) continue;
    const overlapCount = productWords.filter((word) => tokenSet.has(word)).length;
    const overlap = overlapCount / productWords.length;
    let score = overlap * 60;
    if (productSlug && textSlug.includes(productSlug)) score += 60;
    if (makerSlug && textSlug.includes(makerSlug)) score += 18;
    if (slug(kseason) && textSlug.includes(slug(kseason))) score += 12;
    if (year && yearOf(kseason) === year) score += 10;
    if (sport && slug(ksport) === slug(sport)) score += 10;
    if (overlap < 0.5 && !(productSlug && textSlug.includes(productSlug))) continue;
    scored.push({ key, score, overlap });
  }

  scored.sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.key.localeCompare(b.key));
  if (!scored.length) return { match: null as string | null, reason: "no_master_exact_set_match", top: [] as any[] };
  const best = scored[0];
  const second = scored[1];
  if (best.score < 55) return { match: null, reason: "weak_master_exact_set_match", top: scored.slice(0, 5) };
  if (second && best.score - second.score < 8) return { match: null, reason: "ambiguous_master_exact_set_match", top: scored.slice(0, 5) };
  return { match: best.key, reason: null, top: scored.slice(0, 5) };
}

async function withNeutralPacedFetch<T>(work: () => Promise<T>) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const rawUrl = typeof input === "string" ? input : String(input?.url || input);
    const host = new URL(rawUrl).hostname.toLowerCase();
    const gap = 1000 / RPS_CAP;
    const now = Date.now();
    const slot = Math.max(now, nextHostRequest.get(host) || now);
    nextHostRequest.set(host, slot + gap);
    if (slot > now) await sleep(slot - now);
    const headers = new Headers(init?.headers || (typeof input !== "string" ? input?.headers : undefined));
    headers.set("User-Agent", "Mozilla/5.0 (compatible; public-data-client/1.0)");
    headers.set("Accept", headers.get("Accept") || "text/html,application/pdf,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.5");
    return nativeFetch(input as any, { ...(init || {}), headers });
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function main() {
  const parsedInput = JSON.parse(readFileSync(INPUT, "utf8"));
  const queue = (Array.isArray(parsedInput) ? parsedInput : parsedInput.ranked || parsedInput.candidates || []).slice(0, MAX);
  const db = dbClient();
  const master = await loadMasterState(db);
  const startedAt = new Date().toISOString();
  const results: any[] = [];

  for (const candidate of queue) {
    const sourceUrl = String(candidate?.url || "");
    const checkedAt = new Date().toISOString();
    try {
      if (!/^https:\/\//i.test(sourceUrl)) throw new Error("missing https source URL");
      const matched = resolveExactSet(candidate, master);
      if (!matched.match) {
        results.push({ sourceUrl, status: "quarantined", reason: matched.reason, topMatches: matched.top });
        continue;
      }
      const exactSetKey = matched.match;
      if (master.get(exactSetKey)?.imported) {
        results.push({ sourceUrl, exactSetKey, status: "already_imported" });
        continue;
      }

      const [sport, season, manufacturer, product] = exactSetKey.split("|");
      const entry: any = {
        id: `vacuum-mainstream-${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 14)}`,
        sourceName: String(candidate?.sourceId || "public checklist source"),
        sourceUrl,
        fallbackUrls: [],
        authority: /upperdeck\.com|topps\.com|paniniamerica/i.test(new URL(sourceUrl).hostname) ? "official_manufacturer" : "approved_reference_dataset",
        redistributionAllowed: false,
        disposition: "registry_candidate",
        minimumCardRows: MIN_ROWS,
        release: {
          exactSetKey,
          sport,
          season,
          releaseYear: yearOf(season),
          manufacturer,
          brand: null,
          product,
          league: null,
          canonicalName: `${season} ${manufacturer} ${product}`.trim(),
        },
      };

      const downloaded: any = await withNeutralPacedFetch(() => downloadAndParse(entry));
      const rawSource = downloaded.source;
      const plan = buildPlan(entry, downloaded.parsed, rawSource, checkedAt);
      const complexity = assertPlanComplexity(plan);
      const counts = plan.validation.counts;
      const errors = plan.validation.issues.filter((issue: any) => issue.severity === "error");
      const sourceSha256 = createHash("sha256").update(Buffer.from(rawSource.bytes)).digest("hex");
      const common = {
        manufacturer: plan.release.manufacturer || manufacturer,
        sport: plan.release.sport || sport,
        source_url: sourceUrl,
        source_sha256: sourceSha256,
        release_slug: plan.release.releaseSlug,
        release_name: `${season} ${manufacturer} ${product}`.trim(),
        adapter_id: plan.adapterId,
        adapter_version: plan.adapterVersion,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: counts,
        issue_summary: limitedIssues(plan.validation.issues),
        metadata: {
          masterArchiveExactSetKey: exactSetKey,
          vacuumMainstreamAsset: true,
          vacuumSourceId: candidate?.sourceId || null,
          vacuumParentUrl: candidate?.parentUrl || null,
          vacuumReputationScore: candidate?.reputationScore || null,
          sourceMimeType: rawSource.mimeType || null,
          sourceFilename: rawSource.filename || basename(new URL(sourceUrl).pathname),
          planBytes: complexity.serializedBytes,
          parserPath: "mainstream-reference-checklist-v1",
        },
      };

      if (errors.length || plan.validation.status !== "passed" || Number(counts.cards || 0) < MIN_ROWS) {
        await upsertCatalog(db, { ...common, status: "quarantined" });
        results.push({ sourceUrl, exactSetKey, status: "quarantined", reason: "targeted_validation_failed", counts, errors: limitedIssues(errors) });
        continue;
      }
      if (!APPLY) {
        await upsertCatalog(db, { ...common, status: "validated" });
        results.push({ sourceUrl, exactSetKey, status: "validated", counts });
        continue;
      }

      const persistence: any = await persistPlan(db, plan, rawSource.bytes);
      const netNew = persistence?.ok === true && persistence?.idempotent !== true;
      await upsertCatalog(db, { ...common, status: "imported", imported_at: checkedAt });
      master.set(exactSetKey, { imported: true, rows: (master.get(exactSetKey)?.rows || 0) + 1 });
      results.push({ sourceUrl, exactSetKey, status: "imported", counts, persistence, netNew });
    } catch (caught) {
      results.push({ sourceUrl, status: "failed", message: (caught instanceof Error ? caught.message : String(caught)).slice(0, 700) });
    }
  }

  const statuses: Record<string, number> = {};
  for (const row of results) statuses[row.status] = (statuses[row.status] || 0) + 1;
  const receipt = {
    schema: "tcos.checklist.vacuumMainstreamAssetFeedReceipt.v1",
    mode: APPLY ? "apply" : "validate",
    parserPath: "mainstream-reference-checklist-v1",
    startedAt,
    completedAt: new Date().toISOString(),
    candidates: queue.length,
    processed: results.length,
    statuses,
    imported: results.filter((row) => row.status === "imported").length,
    netNew: results.filter((row) => row.status === "imported" && row.netNew === true).length,
    idempotent: results.filter((row) => row.status === "imported" && row.persistence?.idempotent === true).length,
    results,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ candidates: receipt.candidates, processed: receipt.processed, statuses, imported: receipt.imported, netNew: receipt.netNew, idempotent: receipt.idempotent }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
