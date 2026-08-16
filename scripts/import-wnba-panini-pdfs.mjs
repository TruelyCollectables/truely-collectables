import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import {
  ARCHIVE_BUCKET,
  assertPlanComplexity,
  buildPlan,
  dbClient,
  limitedIssues,
  persistPlan,
  uploadArchive,
  upsertCatalog,
} from "./mainstream-checklist/registry-tools.mjs";

const OUTPUT_PATH = resolve(
  process.cwd(),
  process.env.WNBA_IMPORT_OUTPUT || ".checklist-discovery/wnba-panini-import-receipt.json",
);
const MINIMUM_CARD_ROWS = Math.max(25, Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 25));
const USER_AGENT =
  "TCOS-WNBA-Panini-Checklist-Ingest/1.0 (+private Registry automation; contact sales@truelycollectables.com)";

const TARGETS = [
  {
    exactSetKey: "basketball|2024|panini|origins-wnba",
    year: 2024,
    name: "2024 Panini Origins WNBA",
    product: "Origins WNBA",
    url: "https://gogts.net/wp-content/uploads/2024/10/2024-Panini-Origins-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2024|panini|select-wnba",
    year: 2024,
    name: "2024 Panini Select WNBA",
    product: "Select WNBA",
    url: "https://gogts.net/wp-content/uploads/2024/10/2024-Panini-Select-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2024|panini|prizm-wnba",
    year: 2024,
    name: "2024 Panini Prizm WNBA",
    product: "Prizm WNBA",
    url: "https://gogts.net/wp-content/uploads/2025/02/2024-Panini-Prizm-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2025|panini|donruss-wnba",
    year: 2025,
    name: "2025 Donruss WNBA",
    product: "Donruss WNBA",
    url: "https://gogts.net/wp-content/uploads/2025/09/2025-Donruss-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2025|panini|prizm-wnba",
    year: 2025,
    name: "2025 Panini Prizm WNBA",
    product: "Prizm WNBA",
    url: "https://gogts.net/wp-content/uploads/2026/03/2025-Panini-Prizm-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2025|panini|select-wnba",
    year: 2025,
    name: "2025 Panini Select WNBA",
    product: "Select WNBA",
    url: "https://gogts.net/wp-content/uploads/2026/04/2025-Panini-Select-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2025|panini|impeccable-wnba",
    year: 2025,
    name: "2025 Panini Impeccable WNBA",
    product: "Impeccable WNBA",
    url: "https://gogts.net/wp-content/uploads/2025/12/2025-Panini-Impeccable-WNBA-Basketball-Cards-Checklist.pdf",
  },
  {
    exactSetKey: "basketball|2025|panini|one-and-one-wnba",
    year: 2025,
    name: "2025 Panini One and One WNBA",
    product: "One and One WNBA",
    url: "https://gogts.net/wp-content/uploads/2026/03/2025-Panini-One-and-One-WNBA-Basketball-Cards-Checklist.pdf",
  },
];

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function transientMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /timed? out|too many connections|connection.*database|fetch failed|socket|econn|503|504|502|429|temporar/i.test(
    message,
  );
}

async function retry(label, operation, attempts = 8) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!transientMessage(error) || attempt === attempts) throw error;
      const delay = Math.min(30_000, attempt * 5_000);
      console.warn(`${label} transient failure ${attempt}/${attempts}: ${message}; retry in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError || new Error(`${label} failed without an error.`);
}

async function downloadPdf(target) {
  return retry(`download ${target.name}`, async () => {
    const response = await fetch(target.url, {
      headers: {
        Accept: "application/pdf,*/*",
        "Cache-Control": "no-cache",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error("Downloaded PDF was empty.");
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Downloaded PDF exceeded 50 MiB.");
    return {
      bytes,
      finalUrl: response.url || target.url,
      selectedUrl: target.url,
      mimeType: "application/pdf",
      filename: decodeURIComponent(basename(new URL(response.url || target.url).pathname)),
    };
  });
}

function parseTsv(tsv) {
  const lines = String(tsv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("pdftotext TSV output was empty.");
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cardNumber(value) {
  const text = normalized(value).replace(/^#\s*/, "");
  if (!text || /^(?:19|20)\d{2}$/.test(text)) return null;
  if (
    /^\d{1,4}[A-Za-z]?$/.test(text) ||
    (/^[A-Z]{1,12}-?[A-Z0-9]{1,20}$/i.test(text) && /\d/.test(text)) ||
    /^(?:NNO|NO#|NO NUMBER)$/i.test(text)
  ) {
    return text;
  }
  return null;
}

function findHeaderStarts(words) {
  const byPage = new Map();
  for (const word of words) {
    const page = Number(word.page_num);
    const list = byPage.get(page) || [];
    list.push(word);
    byPage.set(page, list);
  }

  for (const [page, pageWords] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const cards = pageWords
      .filter((word) => /^CARD$/i.test(word.text))
      .sort((a, b) => a.left - b.left);
    const athlete = pageWords.find((word) => /^(?:ATHLETE|PLAYER|SUBJECT)$/i.test(word.text));
    const team = pageWords.find((word) => /^TEAM$/i.test(word.text));
    if (cards.length < 2 || !athlete || !team) continue;

    const position = pageWords.find((word) => /^(?:POSITION|POS)$/i.test(word.text));
    const sequence = pageWords.find((word) => /^(?:SEQUENCE|SERIAL|NUMBERED)$/i.test(word.text));
    const starts = [cards[0].left, cards[1].left, athlete.left, team.left];
    if (position && position.left > team.left) starts.push(position.left);
    if (sequence && sequence.left > starts.at(-1)) starts.push(sequence.left);
    return { page, starts };
  }
  throw new Error("Could not detect CARD # / CARD SET / ATHLETE / TEAM columns in Panini PDF.");
}

function parsePaniniPdf(target, source) {
  const work = resolve(tmpdir(), `tcos-wnba-${target.year}-${target.product.replace(/[^a-z0-9]+/gi, "-")}`);
  mkdirSync(work, { recursive: true });
  const pdfPath = resolve(work, source.filename.replace(/[^A-Za-z0-9._-]+/g, "-") || "source.pdf");
  writeFileSync(pdfPath, source.bytes);

  let tsv;
  try {
    tsv = execFileSync("pdftotext", ["-tsv", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 240_000,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const words = parseTsv(tsv)
    .filter((row) => row.level === "5" && row.text && !/^###/.test(row.text))
    .map((row) => ({
      ...row,
      page_num: Number(row.page_num),
      left: numeric(row.left),
      top: numeric(row.top),
    }))
    .filter((row) => Number.isInteger(row.page_num) && row.left !== null && row.top !== null);

  const { page: headerPage, starts } = findHeaderStarts(words);
  const columnIndex = (left) => {
    let index = 0;
    for (let candidate = 0; candidate < starts.length; candidate += 1) {
      if (left + 0.75 >= starts[candidate]) index = candidate;
      else break;
    }
    return index;
  };

  const byPage = new Map();
  for (const word of words) {
    const list = byPage.get(word.page_num) || [];
    list.push(word);
    byPage.set(word.page_num, list);
  }

  const parsedCards = [];
  let nnoCounter = 0;
  for (const [page, pageWords] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const numbers = pageWords
      .filter((word) => columnIndex(word.left) === 0)
      .map((word) => ({ ...word, cardNumber: cardNumber(word.text) }))
      .filter((word) => word.cardNumber)
      .filter((word) => !(page === headerPage && /^CARD$/i.test(word.text)))
      .sort((a, b) => a.top - b.top);

    for (let index = 0; index < numbers.length; index += 1) {
      const row = numbers[index];
      const previousTop =
        index > 0
          ? numbers[index - 1].top
          : row.top - (numbers[index + 1]?.top - row.top || 15);
      const nextTop =
        index + 1 < numbers.length
          ? numbers[index + 1].top
          : row.top + (row.top - previousTop || 15);
      const lower = (previousTop + row.top) / 2;
      const upper = (row.top + nextTop) / 2;
      const columns = Array.from({ length: starts.length }, () => []);

      for (const word of pageWords) {
        if (!(word.top > lower && word.top <= upper)) continue;
        columns[columnIndex(word.left)].push(word);
      }
      const values = columns.map((column) => {
        column.sort((a, b) => a.top - b.top || a.left - b.left);
        return normalized(column.map((word) => word.text).join(" "));
      });

      const setName = values[1];
      const athlete = values[2];
      const team = values[3];
      if (!setName || !athlete || /^CARD\s+SET$/i.test(setName) || /^(?:ATHLETE|PLAYER|SUBJECT)$/i.test(athlete)) {
        continue;
      }
      let number = row.cardNumber;
      if (/^(?:NNO|NO#|NO NUMBER)$/i.test(number)) number = `NNO-${++nnoCounter}`;
      const sequence = values.at(-1);
      const setText = setName.toLowerCase();
      parsedCards.push({
        setName,
        cardNumber: number,
        players: [athlete],
        teams: team ? [team] : [],
        rookieDesignation: /\b(?:rc|rookie)\b/i.test(`${setName} ${athlete}`),
        firstBowmanDesignation: false,
        autographStatus: /autograph|signature|signed/i.test(setText) ? "autograph" : "non-auto",
        memorabiliaStatus: /relic|memorabilia|patch|swatch|jersey|materials?/i.test(setText)
          ? "memorabilia"
          : "non-memorabilia",
        variation: null,
        sourceNotes: normalized(
          `Panini PDF table row page ${page}${sequence ? `; sequence ${sequence}` : ""}`,
        ),
      });
    }
  }

  const deduped = [];
  const byIdentity = new Map();
  for (const card of parsedCards) {
    const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const prior = byIdentity.get(key);
    if (!prior) {
      byIdentity.set(key, card);
      deduped.push(card);
      continue;
    }
    const samePlayers =
      prior.players.map((value) => value.toLowerCase()).sort().join("+") ===
      card.players.map((value) => value.toLowerCase()).sort().join("+");
    if (samePlayers) {
      prior.teams = [...new Set([...prior.teams, ...card.teams])];
      continue;
    }
    prior.players = [...new Set([...prior.players, ...card.players])];
    prior.teams = [...new Set([...prior.teams, ...card.teams])];
    prior.rookieDesignation = prior.rookieDesignation || card.rookieDesignation;
    if (card.autographStatus === "autograph") prior.autographStatus = "autograph";
    if (card.memorabiliaStatus === "memorabilia") prior.memorabiliaStatus = "memorabilia";
    prior.sourceNotes = normalized(`${prior.sourceNotes}; source-proven multi-subject card`);
  }

  const setCount = new Set(deduped.map((card) => card.setName.toLowerCase())).size;
  if (deduped.length < MINIMUM_CARD_ROWS) {
    throw new Error(
      `${target.name}: only ${deduped.length} structured Panini card rows parsed; ${MINIMUM_CARD_ROWS} required.`,
    );
  }
  if (deduped.length > 100_000) {
    throw new Error(`${target.name}: parsed ${deduped.length} rows, over the 100000 safety limit.`);
  }

  return {
    cards: deduped,
    parallels: [],
    warnings: [
      {
        code: "panini_card_set_column_preserved_as_registry_sets",
        severity: "warning",
        message: `Parsed ${deduped.length} structured rows across ${setCount} Panini CARD SET values; CARD SET values are preserved as Registry sets so parallel/variant identities are not discarded.`,
      },
    ],
    errors: [],
    structured: {
      rows: deduped.length,
      setCount,
      columnStarts: starts,
    },
  };
}

function entryFor(target) {
  return {
    id: `priority-wnba-${target.year}-${target.product.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    disposition: "import",
    sourceName: "GoGTS",
    sourceUrl: target.url,
    fallbackUrls: [],
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: MINIMUM_CARD_ROWS,
    release: {
      exactSetKey: target.exactSetKey,
      canonicalName: target.name,
      manufacturer: "Panini",
      brand: null,
      product: target.product,
      releaseYear: target.year,
      season: String(target.year),
      sport: "basketball",
      league: "WNBA",
    },
  };
}

async function importTarget(db, target) {
  const checkedAt = new Date().toISOString();
  const source = await downloadPdf(target);
  const parsed = parsePaniniPdf(target, source);
  console.log(
    `${target.name}: structured rows=${parsed.structured.rows}, card sets=${parsed.structured.setCount}, bytes=${source.bytes.byteLength}`,
  );

  const archive = await retry(`raw archive ${target.name}`, () => uploadArchive(db, source));
  const plan = buildPlan(entryFor(target), parsed, source, checkedAt);
  const complexity = assertPlanComplexity(plan);
  const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
  if (errors.length || plan.validation.status !== "passed") {
    throw new Error(
      `${target.name}: Registry plan validation failed: ${errors
        .slice(0, 5)
        .map((error) => error.message)
        .join(" | ")}`,
    );
  }

  const persistence = await retry(`Registry persistence ${target.name}`, () =>
    persistPlan(db, plan, source.bytes),
  );
  if (!persistence || persistence.ok !== true) {
    throw new Error(`${target.name}: Registry persistence did not return ok=true.`);
  }

  await retry(`catalog import status ${target.name}`, () =>
    upsertCatalog(db, {
      manufacturer: "Panini",
      sport: "basketball",
      source_url: source.finalUrl || target.url,
      source_sha256: archive.digest,
      release_slug: plan.release.releaseSlug,
      release_name: target.name,
      adapter_id: plan.adapterId,
      adapter_version: plan.adapterVersion,
      status: "imported",
      imported_at: checkedAt,
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      validation_counts: plan.validation.counts,
      issue_summary: limitedIssues(plan.validation.issues),
      metadata: {
        priorityWnbaProductionLoad: true,
        exactSetKey: target.exactSetKey,
        parser: "panini-pdf-tsv-v1",
        structuredRows: parsed.structured.rows,
        cardSetCount: parsed.structured.setCount,
        cardSetValuesPreservedAsRegistrySets: true,
        rawArchived: true,
        archiveBucket: ARCHIVE_BUCKET,
        archiveObjectPath: archive.objectPath,
        sourceMimeType: source.mimeType,
        sourceSizeBytes: source.bytes.byteLength,
        planBytes: complexity.serializedBytes,
      },
    }),
  );

  return {
    exactSetKey: target.exactSetKey,
    name: target.name,
    status: "imported",
    sourceUrl: source.finalUrl || target.url,
    counts: plan.validation.counts,
    structuredRows: parsed.structured.rows,
    cardSetCount: parsed.structured.setCount,
    persistence,
  };
}

async function main() {
  mkdirSync(resolve(OUTPUT_PATH, ".."), { recursive: true });
  const db = dbClient();
  const startedAt = new Date().toISOString();
  const results = [];

  for (const target of TARGETS) {
    console.log(`\n=== ${target.name} ===`);
    try {
      results.push(await importTarget(db, target));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${target.name}: ${message}`);
      results.push({
        exactSetKey: target.exactSetKey,
        name: target.name,
        status: "failed",
        sourceUrl: target.url,
        message,
      });
    }
  }

  const imported = results.filter(
    (result) => result.status === "imported" && result.persistence?.ok === true,
  );
  const receipt = {
    schema: "tcos.checklist.wnbaPaniniStructuredImportReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    expected: TARGETS.length,
    imported: imported.length,
    failed: results.length - imported.length,
    results,
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
