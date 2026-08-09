import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { downloadAndParse, runParserSelfTest, slug } from "./mainstream-checklist/source-tools.mjs";
import {
  assertPlanComplexity,
  buildPlan,
  dbClient,
  ensureArchiveBucket,
  limitedIssues,
  persistPlan,
  uploadArchive,
  upsertCatalog,
} from "./mainstream-checklist/registry-tools.mjs";

const APPLY = process.env.CHECKLIST_RECOVERY_APPLY === "true";
const BATCH_INDEX = Math.max(0, Number(process.env.CHECKLIST_RECOVERY_BATCH_INDEX || 0));
const BATCH_SIZE = Math.max(1, Math.min(25, Number(process.env.CHECKLIST_RECOVERY_BATCH_SIZE || 15)));
const WORKERS = Math.max(1, Math.min(4, Number(process.env.CHECKLIST_RECOVERY_WORKERS || 2)));
const OUTPUT_ROOT = resolve(
  process.cwd(),
  process.env.CHECKLIST_RECOVERY_OUTPUT_ROOT || "evidence/verified-checklist-recovery",
);
const OUTPUT = resolve(OUTPUT_ROOT, `batch-${BATCH_INDEX}-receipt.json`);
const PYTHON_SOURCE_FILES = [
  "services/instacomp-ai/app/verified_checklist_sources.py",
  "services/instacomp-ai/app/verified_checklist_sources_modern_extra.py",
];

function verifiedSourcesFromPython() {
  const python = String.raw`
import ast, json, pathlib
paths = ${JSON.stringify(PYTHON_SOURCE_FILES)}
out = []
for name in paths:
    path = pathlib.Path(name)
    tree = ast.parse(path.read_text('utf-8'), filename=name)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        is_source = (
            isinstance(func, ast.Name) and func.id == 'VerifiedChecklistSource'
        ) or (
            isinstance(func, ast.Attribute) and func.attr == 'VerifiedChecklistSource'
        )
        if not is_source or len(node.args) < 6:
            continue
        values = [ast.literal_eval(arg) for arg in node.args[:7]]
        while len(values) < 7:
            values.append('2026-08-09')
        out.append({
            'targetKey': values[0],
            'sourceId': values[1],
            'title': values[2],
            'url': values[3],
            'trustScore': int(values[4]),
            'provenance': values[5],
            'verifiedOn': values[6],
        })
print(json.dumps(out, separators=(',', ':')))
`;
  const raw = execFileSync("python3", ["-c", python], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const values = JSON.parse(raw);
  const exact = new Map();
  for (const source of values) {
    const key = `${source.targetKey}\n${source.url}`;
    if (!exact.has(key)) exact.set(key, source);
  }
  return [...exact.values()];
}

function targetParts(targetKey) {
  const [sport, season, manufacturer, product, ...extra] = String(targetKey || "").split("|");
  if (!sport || !season || !manufacturer || !product || extra.length) {
    throw new Error(`Invalid exact target key: ${targetKey}`);
  }
  const match = season.match(/^(\d{4})/);
  if (!match) throw new Error(`Target season has no release year: ${targetKey}`);
  return {
    sport,
    season,
    manufacturer,
    product,
    releaseYear: Number(match[1]),
  };
}

function canonicalName(targetKey) {
  const value = targetParts(targetKey);
  return [value.season, value.manufacturer, value.product, value.sport].join(" ");
}

function entryFor(targetKey, source) {
  const release = targetParts(targetKey);
  return {
    id: targetKey,
    disposition: "standalone",
    sourceName: source.sourceId,
    sourceUrl: source.url,
    fallbackUrls: [],
    authority: source.sourceId === "topps" && source.trustScore >= 100
      ? "official_manufacturer"
      : "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: 3,
    release: {
      canonicalName: canonicalName(targetKey),
      exactSetKey: targetKey,
      manufacturer: release.manufacturer,
      brand: null,
      product: release.product,
      releaseYear: release.releaseYear,
      season: release.season,
      sport: release.sport,
      league: null,
    },
  };
}

function chromeBinary() {
  const configured = String(process.env.CHECKLIST_RECOVERY_CHROME_BIN || "").trim();
  const candidates = [
    configured,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate.includes("/")) {
        execFileSync("test", ["-x", candidate], { stdio: "ignore" });
        return candidate;
      }
      return execFileSync("which", [candidate], { encoding: "utf8" }).trim();
    } catch {
      // Try the next browser.
    }
  }
  return null;
}

function absoluteHrefDocument(html, sourceUrl) {
  return String(html || "").replace(
    /\bhref=(['"])([^'"#][^'"]*)\1/gi,
    (whole, quote, href) => {
      if (/^(?:data:|javascript:|mailto:|tel:)/i.test(href)) return whole;
      try {
        return `href=${quote}${new URL(href, sourceUrl).toString()}${quote}`;
      } catch {
        return whole;
      }
    },
  );
}

async function withCapturedPage(entry, source) {
  const chrome = chromeBinary();
  if (!chrome) throw new Error("No Chrome/Chromium binary is available for verified page capture.");
  const html = execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--virtual-time-budget=30000",
      "--dump-dom",
      source.url,
    ],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 150_000,
      env: { ...process.env, HOME: process.env.HOME || "/tmp" },
    },
  );
  if (html.length < 3_000 || !/checklist/i.test(html)) {
    throw new Error("Rendered page did not expose a substantive checklist document.");
  }
  if (/cf-chl-|enable javascript and cookies|just a moment/i.test(html)) {
    throw new Error("Rendered page remained behind an interstitial.");
  }
  const captured = absoluteHrefDocument(html, source.url);
  const server = createServer((request, response) => {
    if (request.url !== "/source.html") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(captured);
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Capture server did not bind a TCP port.");
    const localUrl = `http://127.0.0.1:${address.port}/source.html`;
    const selected = await downloadAndParse({ ...entry, sourceUrl: localUrl, fallbackUrls: [] });
    if (String(selected.source.selectedUrl || "").startsWith("http://127.0.0.1:")) {
      selected.source.selectedUrl = source.url;
      selected.source.finalUrl = source.url;
      selected.source.filename = `${slug(entry.release.canonicalName)}-captured.html`;
    }
    selected.capture = {
      mode: "headless_chrome_dom",
      originalUrl: source.url,
      capturedBytes: Buffer.byteLength(captured, "utf8"),
    };
    return selected;
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function needsCapture(source, selected, error) {
  const host = (() => {
    try { return new URL(source.url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (!host.endsWith("beckett.com")) return false;
  if (error) return true;
  const parserErrors = selected?.parsed?.errors?.filter((issue) => issue.severity === "error") || [];
  return Number(selected?.parsed?.cards?.length || 0) < 3 || parserErrors.length > 0;
}

async function parseSource(entry, source) {
  let direct = null;
  let directError = null;
  try {
    direct = await downloadAndParse(entry);
  } catch (error) {
    directError = error;
  }
  if (!needsCapture(source, direct, directError)) {
    if (directError) throw directError;
    return { ...direct, capture: null, attempts: [{ mode: "direct", status: "selected" }] };
  }
  const attempts = [];
  if (direct) {
    attempts.push({
      mode: "direct",
      status: "rejected",
      cards: direct.parsed.cards.length,
      issues: limitedIssues(direct.parsed.errors || []),
    });
  } else if (directError) {
    attempts.push({
      mode: "direct",
      status: "failed",
      message: String(directError instanceof Error ? directError.message : directError).slice(0, 500),
    });
  }
  const captured = await withCapturedPage(entry, source);
  return { ...captured, attempts: [...attempts, { mode: "capture", status: "selected" }] };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeSpreadsheet(targetKey, parsed) {
  const dir = resolve(OUTPUT_ROOT, `batch-${BATCH_INDEX}`, "spreadsheets");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${slug(targetKey)}.csv`);
  const header = [
    "set_name",
    "card_number",
    "players",
    "teams",
    "rookie",
    "first_bowman",
    "autograph_status",
    "memorabilia_status",
    "variation",
    "source_notes",
  ];
  const rows = parsed.cards.map((card) => [
    card.setName,
    card.cardNumber,
    card.players,
    card.teams,
    card.rookieDesignation,
    card.firstBowmanDesignation,
    card.autographStatus,
    card.memorabiliaStatus,
    card.variation,
    card.sourceNotes,
  ]);
  writeFileSync(
    path,
    [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n",
    "utf8",
  );
  return path;
}

function catalogMetadata(targetKey, source, selected, plan, archive, attempts) {
  return {
    verifiedRecoverySchema: "tcos.checklist.verifiedRecovery.v1",
    verifiedRecoveryTargetKey: targetKey,
    verifiedRecoverySourceId: source.sourceId,
    verifiedRecoveryTitle: source.title,
    verifiedRecoveryTrustScore: source.trustScore,
    verifiedRecoveryProvenance: source.provenance,
    verifiedRecoveryVerifiedOn: source.verifiedOn,
    browserCapture: selected.capture || null,
    selectedUrl: selected.source.selectedUrl,
    finalUrl: selected.source.finalUrl,
    sourceMimeType: selected.source.mimeType,
    sourceSizeBytes: selected.source.bytes.byteLength,
    archiveBucket: "tcos-checklist-universal-archive",
    archiveObjectPath: archive?.objectPath || null,
    validationCounts: plan.validation.counts,
    sourceAttempts: attempts.slice(0, 12),
  };
}

async function catalogState(db, urls) {
  if (!db || !urls.length) return new Map();
  const rows = [];
  const unique = [...new Set(urls)];
  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("source_url,status,metadata,validation_counts")
      .in("source_url", unique.slice(index, index + 100));
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    rows.push(...(data || []));
  }
  return new Map(rows.map((row) => [row.source_url, row]));
}

function existingTarget(targetKey, sources, state) {
  for (const source of sources) {
    const row = state.get(source.url);
    if (!row || !["imported", "unchanged"].includes(row.status)) continue;
    if (row.metadata?.verifiedRecoveryTargetKey === targetKey) return row;
  }
  return null;
}

async function processTarget(db, target, state) {
  const existing = existingTarget(target.targetKey, target.sources, state);
  if (existing) {
    return {
      targetKey: target.targetKey,
      status: "already_live",
      counts: existing.validation_counts || null,
    };
  }

  const failures = [];
  for (const source of target.sources) {
    const entry = entryFor(target.targetKey, source);
    let selected;
    try {
      selected = await parseSource(entry, source);
    } catch (error) {
      failures.push({
        sourceId: source.sourceId,
        url: source.url,
        stage: "download_or_capture",
        message: String(error instanceof Error ? error.message : error).slice(0, 800),
      });
      continue;
    }

    const parserErrors = (selected.parsed.errors || []).filter((issue) => issue.severity === "error");
    if (parserErrors.length || selected.parsed.cards.length < 3) {
      failures.push({
        sourceId: source.sourceId,
        url: source.url,
        stage: "parse",
        cards: selected.parsed.cards.length,
        issues: limitedIssues(parserErrors),
      });
      continue;
    }

    const plan = buildPlan(entry, selected.parsed, selected.source, new Date().toISOString());
    const planErrors = plan.validation.issues.filter((issue) => issue.severity === "error");
    if (planErrors.length) {
      failures.push({
        sourceId: source.sourceId,
        url: source.url,
        stage: "plan",
        issues: limitedIssues(planErrors),
      });
      continue;
    }
    assertPlanComplexity(plan);
    const spreadsheetPath = writeSpreadsheet(target.targetKey, selected.parsed);

    if (!APPLY) {
      return {
        targetKey: target.targetKey,
        status: "validated",
        sourceId: source.sourceId,
        sourceUrl: source.url,
        selectedUrl: selected.source.selectedUrl,
        capture: selected.capture || null,
        counts: plan.validation.counts,
        spreadsheetPath,
      };
    }

    try {
      const archive = await uploadArchive(db, selected.source);
      const persistence = await persistPlan(db, plan, selected.source.bytes);
      const checkedAt = new Date().toISOString();
      await upsertCatalog(db, {
        manufacturer: entry.release.manufacturer,
        sport: entry.release.sport,
        source_url: source.url,
        source_sha256: archive.digest,
        release_slug: plan.release.releaseSlug,
        release_name: entry.release.canonicalName,
        adapter_id: plan.adapterId,
        adapter_version: plan.adapterVersion,
        status: "imported",
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        imported_at: checkedAt,
        validation_counts: plan.validation.counts,
        issue_summary: limitedIssues(plan.validation.issues),
        metadata: catalogMetadata(
          target.targetKey,
          source,
          selected,
          plan,
          archive,
          [...failures, ...(selected.attempts || [])],
        ),
      });
      return {
        targetKey: target.targetKey,
        status: "imported",
        sourceId: source.sourceId,
        sourceUrl: source.url,
        selectedUrl: selected.source.selectedUrl,
        capture: selected.capture || null,
        counts: plan.validation.counts,
        spreadsheetPath,
        persistence,
      };
    } catch (error) {
      failures.push({
        sourceId: source.sourceId,
        url: source.url,
        stage: "registry",
        message: String(error instanceof Error ? error.message : error).slice(0, 800),
      });
    }
  }

  if (APPLY && target.sources[0]) {
    const first = target.sources[0];
    const checkedAt = new Date().toISOString();
    await upsertCatalog(db, {
      manufacturer: targetParts(target.targetKey).manufacturer,
      sport: targetParts(target.targetKey).sport,
      source_url: first.url,
      release_name: canonicalName(target.targetKey),
      status: "quarantined",
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      validation_counts: { sets: 0, cards: 0, parallels: 0, identities: 0 },
      issue_summary: [{
        code: "verified_recovery_not_promoted",
        severity: "error",
        message: `No verified source passed fail-closed validation for ${target.targetKey}.`,
      }],
      metadata: {
        verifiedRecoverySchema: "tcos.checklist.verifiedRecovery.v1",
        verifiedRecoveryTargetKey: target.targetKey,
        sourceAttempts: failures.slice(0, 12),
      },
    });
  }

  return {
    targetKey: target.targetKey,
    status: "quarantined",
    failures: failures.slice(0, 12),
  };
}

async function parallelMap(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        output[index] = await worker(values[index], index);
      }
    }),
  );
  return output;
}

function targetInventory() {
  const grouped = new Map();
  for (const source of verifiedSourcesFromPython()) {
    const values = grouped.get(source.targetKey) || [];
    values.push(source);
    grouped.set(source.targetKey, values);
  }
  return [...grouped.entries()]
    .map(([targetKey, sources]) => ({
      targetKey,
      sources: sources.sort((left, right) => right.trustScore - left.trustScore),
    }))
    .sort((left, right) => left.targetKey.localeCompare(right.targetKey));
}

function writeReceipt(value) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const parserSelfTest = runParserSelfTest();
  const inventory = targetInventory();
  if (inventory.length < 70) {
    throw new Error(`Verified recovery inventory unexpectedly shrank to ${inventory.length} targets.`);
  }
  const start = BATCH_INDEX * BATCH_SIZE;
  const selected = inventory.slice(start, start + BATCH_SIZE);
  const startedAt = new Date().toISOString();

  let db = null;
  let state = new Map();
  if (APPLY) {
    db = dbClient();
    await ensureArchiveBucket(db);
    state = await catalogState(db, selected.flatMap((target) => target.sources.map((source) => source.url)));
  }

  const results = await parallelMap(selected, WORKERS, (target) => processTarget(db, target, state));
  const statuses = {};
  const normalizedTotals = { sets: 0, cards: 0, parallels: 0, identities: 0 };
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    if (["imported", "validated", "already_live"].includes(result.status)) {
      for (const key of Object.keys(normalizedTotals)) {
        normalizedTotals[key] += Number(result.counts?.[key] || 0);
      }
    }
  }
  writeReceipt({
    schema: "tcos.checklist.verifiedRecoveryBatchReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "validate",
    parserSelfTest,
    inventoryTargets: inventory.length,
    batch: {
      index: BATCH_INDEX,
      size: BATCH_SIZE,
      start,
      selected: selected.length,
      targetKeys: selected.map((target) => target.targetKey),
    },
    workers: WORKERS,
    statuses,
    normalizedTotals,
    results,
  });

  const bad = results.filter((result) => result.status === "quarantined");
  if (!APPLY && bad.length === selected.length && selected.length) {
    throw new Error(`Every target in verification batch ${BATCH_INDEX} was quarantined.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
