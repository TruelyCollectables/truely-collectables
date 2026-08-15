import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { downloadAndParse } from "./source-tools.mjs";
import { normalizeGoGtsStructuredText } from "./gogts-structured-normalizer.mjs";
import {
  assertPlanComplexity,
  buildPlan,
  dbClient,
  limitedIssues,
  persistPlan,
  upsertCatalog,
} from "./registry-tools.mjs";

const INPUT = resolve(process.cwd(), process.env.GOGTS_OFFLINE_INPUT || "tmp/gogts-offline-queue.json");
const OUTPUT = resolve(process.cwd(), process.env.GOGTS_OFFLINE_OUTPUT || "tmp/gogts-offline-receipt.json");
const APPLY = process.env.GOGTS_OFFLINE_APPLY === "true";
const MAX = Math.max(1, Number(process.env.GOGTS_OFFLINE_MAX || 2200));
const MIN_ROWS = Math.max(25, Number(process.env.GOGTS_OFFLINE_MIN_ROWS || 25));
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/gogts-offline-parser");

function yearOf(value: unknown) {
  const m = String(value || "").match(/(?:19|20)\d{2}/);
  return m ? m[0] : "";
}

function mimeFromPath(path: string) {
  const e = extname(path).toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".xls") return "application/vnd.ms-excel";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".csv") return "text/csv";
  return "application/octet-stream";
}

function extractText(localPath: string, mimeType: string) {
  const bytes = readFileSync(localPath);
  const lower = mimeType.toLowerCase();
  if (lower === "text/csv" || lower.startsWith("text/")) return bytes.toString("utf8").trim();
  mkdirSync(TEMP_ROOT, { recursive: true });
  if (lower === "application/pdf") {
    return execFileSync("pdftotext", ["-layout", "-nopgbrk", localPath, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    }).trim();
  }
  if (lower === "application/vnd.ms-excel" || lower === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const python = String.raw`
import sys
path, mime = sys.argv[1], sys.argv[2]
rows = []
if path.lower().endswith('.xlsx') or 'openxmlformats' in mime:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows.append('## ' + ws.title)
        for row in ws.iter_rows(values_only=True):
            vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
            if vals: rows.append(' | '.join(vals))
else:
    import xlrd
    wb = xlrd.open_workbook(path)
    for ws in wb.sheets():
        rows.append('## ' + ws.name)
        for r in range(ws.nrows):
            vals = [str(ws.cell_value(r, c)).strip() for c in range(ws.ncols) if str(ws.cell_value(r, c)).strip()]
            if vals: rows.append(' | '.join(vals))
print('\n'.join(rows))
`;
    return execFileSync("python3", ["-c", python, localPath, lower], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    }).trim();
  }
  throw new Error(`Unsupported offline source format: ${mimeType}`);
}

async function loadMasterState(db: ReturnType<typeof dbClient>) {
  const state = new Map<string, { imported: boolean }>();
  for (let start = 0; start < 12000; start += 1000) {
    const { data, error } = await db.from("checklist_source_catalog").select("status,metadata").range(start, start + 999);
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    for (const row of data || []) {
      const key = String((row as any)?.metadata?.masterArchiveExactSetKey || (row as any)?.metadata?.exactSetKey || "").toLowerCase();
      if (!key || key.split("|").length !== 4) continue;
      const current = state.get(key) || { imported: false };
      current.imported ||= (row as any).status === "imported";
      state.set(key, current);
    }
    if (!data || data.length < 1000) break;
  }
  return state;
}

async function parseSavedChecklist(params: {
  exactSetKey: string;
  localPath: string;
  sourceUrl: string;
}) {
  const [sport, season, manufacturer, product] = params.exactSetKey.split("|");
  const mimeType = mimeFromPath(params.localPath);
  const rawBytes = readFileSync(params.localPath);
  const extracted = extractText(params.localPath, mimeType);
  const normalizedText = normalizeGoGtsStructuredText(extracted);
  const offlineUrl = `https://offline.invalid/${encodeURIComponent(createHash("sha256").update(rawBytes).digest("hex"))}.txt`;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url || input);
    if (url === offlineUrl) {
      return new Response(Buffer.from(normalizedText, "utf8"), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return nativeFetch(input as any, init);
  }) as typeof fetch;

  const entry: any = {
    id: `gogts-offline-${createHash("sha256").update(params.exactSetKey).digest("hex").slice(0, 12)}`,
    sourceName: "GoGTS preserved archive",
    sourceUrl: offlineUrl,
    fallbackUrls: [],
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    disposition: "registry_candidate",
    minimumCardRows: MIN_ROWS,
    release: {
      exactSetKey: params.exactSetKey,
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

  try {
    const parsedDownload = await downloadAndParse(entry);
    return {
      entry,
      parsed: parsedDownload.parsed,
      rawSource: {
        bytes: new Uint8Array(rawBytes),
        finalUrl: params.sourceUrl,
        selectedUrl: params.sourceUrl,
        mimeType,
        filename: basename(params.localPath),
      },
      normalizedTextBytes: Buffer.byteLength(normalizedText, "utf8"),
    };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function main() {
  const parsedInput = JSON.parse(readFileSync(INPUT, "utf8"));
  const queue = (Array.isArray(parsedInput) ? parsedInput : parsedInput.candidates || []).slice(0, MAX);
  const db = dbClient();
  const master = await loadMasterState(db);
  const startedAt = new Date().toISOString();
  const results: any[] = [];

  for (const candidate of queue) {
    const exactSetKey = String(candidate.exactSetKey || "").toLowerCase();
    const localPath = resolve(String(candidate.localPath || ""));
    const sourceUrl = String(candidate.sourceUrl || candidate.articleUrl || "");
    const checkedAt = new Date().toISOString();
    try {
      if (!exactSetKey || exactSetKey.split("|").length !== 4) throw new Error("missing exactSetKey");
      if (!master.has(exactSetKey)) {
        results.push({ exactSetKey, sourceUrl, status: "skipped", reason: "not_in_current_master_catalog" });
        continue;
      }
      if (master.get(exactSetKey)?.imported) {
        results.push({ exactSetKey, sourceUrl, status: "already_imported" });
        continue;
      }
      if (!sourceUrl.startsWith("https://gogts.net/")) throw new Error("unexpected GoGTS attribution URL");

      const bytes = readFileSync(localPath);
      if (bytes.byteLength < 128) throw new Error(`archived source too small (${bytes.byteLength} bytes)`);
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      const [sport, season, manufacturer, product] = exactSetKey.split("|");
      const prepared = await parseSavedChecklist({ exactSetKey, localPath, sourceUrl });
      const plan = buildPlan(prepared.entry, prepared.parsed, prepared.rawSource, checkedAt);
      const complexity = assertPlanComplexity(plan);
      const counts = plan.validation.counts;
      const errors = plan.validation.issues.filter((issue: any) => issue.severity === "error");
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
          gogtsOfflineArchive: true,
          masterArchiveRunId: "31100986894",
          archivedLocalFilename: basename(localPath),
          sourceMimeType: prepared.rawSource.mimeType,
          normalizedTextBytes: prepared.normalizedTextBytes,
          planBytes: complexity.serializedBytes,
          parserPath: "mainstream-reference-checklist-v1",
        },
      };

      if (errors.length || plan.validation.status !== "passed" || Number(counts.cards || 0) < MIN_ROWS) {
        await upsertCatalog(db, { ...common, status: "quarantined" });
        results.push({ exactSetKey, sourceUrl, status: "quarantined", reason: "targeted_validation_failed", counts, errors: limitedIssues(errors) });
        continue;
      }

      if (!APPLY) {
        await upsertCatalog(db, { ...common, status: "validated" });
        results.push({ exactSetKey, sourceUrl, status: "validated", counts });
        continue;
      }

      const persistence: any = await persistPlan(db, plan, prepared.rawSource.bytes);
      await upsertCatalog(db, { ...common, status: "imported", imported_at: checkedAt });
      const netNew = persistence?.ok === true && persistence?.idempotent !== true;
      master.set(exactSetKey, { imported: true });
      results.push({ exactSetKey, sourceUrl, status: "imported", counts, persistence, netNew });
    } catch (caught) {
      results.push({ exactSetKey, sourceUrl, status: "failed", message: (caught instanceof Error ? caught.message : String(caught)).slice(0, 700) });
    }
  }

  rmSync(TEMP_ROOT, { recursive: true, force: true });
  const statuses: Record<string, number> = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] || 0) + 1;
  const receipt = {
    schema: "tcos.checklist.gogtsOfflineArchiveFeedReceipt.v2",
    mode: APPLY ? "apply" : "validate",
    parserPath: "mainstream-reference-checklist-v1",
    startedAt,
    completedAt: new Date().toISOString(),
    candidates: queue.length,
    processed: results.length,
    statuses,
    imported: results.filter((r) => r.status === "imported").length,
    netNew: results.filter((r) => r.status === "imported" && r.netNew === true).length,
    idempotent: results.filter((r) => r.status === "imported" && r.persistence?.idempotent === true).length,
    results,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ candidates: receipt.candidates, processed: receipt.processed, statuses, imported: receipt.imported, netNew: receipt.netNew, idempotent: receipt.idempotent }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
