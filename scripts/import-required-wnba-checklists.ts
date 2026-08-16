import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChecklistIdentityFingerprint } from "../src/lib/checklist-registry/identity";
import type {
  ChecklistImportCard,
  ChecklistImportParallel,
  ChecklistImportPlan,
  ChecklistImportSet,
  ChecklistImportValidationIssue,
} from "../src/lib/checklist-registry/source-adapter";
import { buildChecklistSourceStorageReceipt } from "../src/lib/checklist-registry/storage";
import { postChecklistRegistryAction } from "./lib/checklist-registry-action-client";

type SourceConfig = {
  key: string;
  releaseYear: "2024" | "2025";
  brand: string;
  product: string;
  releaseSlug: string;
  url: string;
};

type XlsRow = {
  cardNumber: string;
  cardSet: string;
  athlete: string;
  team: string;
  position: string;
  sequence: string;
  sheet: string;
};

type ParsedXls = {
  schema: "tcos.panini.xlsRows.v1";
  source: string;
  sheetCount: number;
  sheets: string[];
  rowCount: number;
  rows: XlsRow[];
};

type MappedRow = XlsRow & {
  rootSet: string;
  parallelName: string | null;
  serialRun: number | null;
};

const SOURCES: SourceConfig[] = [
  {
    key: "2024-origins-wnba",
    releaseYear: "2024",
    brand: "Origins",
    product: "Origins WNBA",
    releaseSlug: "2024-panini-origins-wnba",
    url: "https://gogts.net/wp-content/uploads/2024/10/2024-Panini-Origins-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2024-prizm-wnba",
    releaseYear: "2024",
    brand: "Prizm",
    product: "Prizm WNBA",
    releaseSlug: "2024-panini-prizm-wnba",
    url: "https://gogts.net/wp-content/uploads/2025/02/2024-Panini-Prizm-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2024-select-wnba",
    releaseYear: "2024",
    brand: "Select",
    product: "Select WNBA",
    releaseSlug: "2024-panini-select-wnba",
    url: "https://gogts.net/wp-content/uploads/2024/10/2024-Panini-Select-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2025-donruss-wnba",
    releaseYear: "2025",
    brand: "Donruss",
    product: "Donruss WNBA",
    releaseSlug: "2025-panini-donruss-wnba",
    url: "https://gogts.net/wp-content/uploads/2025/09/2025-Donruss-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2025-impeccable-wnba",
    releaseYear: "2025",
    brand: "Impeccable",
    product: "Impeccable WNBA",
    releaseSlug: "2025-panini-impeccable-wnba",
    url: "https://gogts.net/wp-content/uploads/2025/12/2025-Panini-Impeccable-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2025-one-and-one-wnba",
    releaseYear: "2025",
    brand: "One and One",
    product: "One and One WNBA",
    releaseSlug: "2025-panini-one-and-one-wnba",
    url: "https://gogts.net/wp-content/uploads/2026/03/2025-Panini-One-and-One-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2025-prizm-wnba",
    releaseYear: "2025",
    brand: "Prizm",
    product: "Prizm WNBA",
    releaseSlug: "2025-panini-prizm-wnba",
    url: "https://gogts.net/wp-content/uploads/2026/03/2025-Panini-Prizm-WNBA-Basketball-Cards-Checklist.xls",
  },
  {
    key: "2025-select-wnba",
    releaseYear: "2025",
    brand: "Select",
    product: "Select WNBA",
    releaseSlug: "2025-panini-select-wnba",
    url: "https://gogts.net/wp-content/uploads/2026/04/2025-Panini-Select-WNBA-Basketball-Cards-Checklist.xls",
  },
];

const OUTPUT = process.env.WNBA_CHECKLIST_OUTPUT || ".wnba-checklist-import/receipt.json";
const WORK_DIR = ".wnba-checklist-import/sources";
const parserPath = join(dirname(fileURLToPath(import.meta.url)), "lib", "parse-panini-xls.py");

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function splitList(value: string) {
  return [...new Set(clean(value)
    .split(/\s*\/\s*/)
    .map(clean)
    .filter(Boolean))];
}

function serialRun(value: string) {
  const text = clean(value);
  if (!text) return null;
  const slash = text.match(/\/(\d{1,7})\b/);
  if (slash) return Number(slash[1]);
  const number = text.match(/^\d{1,7}$/);
  return number ? Number(number[0]) : null;
}

const PARALLEL_WORDS = /\b(prizms?|holo|silver|gold|black|blue|green|red|orange|pink|purple|teal|white|yellow|bronze|platinum|emerald|ruby|sapphire|amethyst|diamond|finite|vinyl|velocity|pulsar|mojo|ice|laser|shimmer|lava|cubic|dragon|checker(?:board)?|sparkle|scope|pandora|camo|disco|flash|swirl|proof|artist|wave|tiger|zebra|elephant|snake\s*skin|snakeskin|cherry blossom|f\.?o\.?t\.?l\.?|choice|fast break|neon|cosmic|hyper|fractal|groovy|revolution|one of one|1 of 1|variation|logo)\b/i;
const NON_PARALLEL_SUFFIX = /\b(autographs?|signatures?|memorabilia|jerseys?|swatches?|patches?|materials?|relics?|rookies?)\b/i;

function looksLikeParallelSuffix(value: string) {
  const suffix = clean(value);
  return Boolean(suffix && PARALLEL_WORDS.test(suffix) && !NON_PARALLEL_SUFFIX.test(suffix));
}

function baseRootCandidate(value: string) {
  const text = clean(value);
  return /^(?:Base|Base (?:Concourse|Premier Level|Courtside|Mezzanine))$/i.test(text);
}

function normalizeParallelName(value: string) {
  let text = clean(value).replace(/^[-–—:\s]+|[-–—:\s]+$/g, "");
  text = text.replace(/^Prizms?\s+/i, "").replace(/\s+Prizms?$/i, "");
  return clean(text) || clean(value);
}

function mapRows(rows: XlsRow[]) {
  const labels = [...new Set(rows.map((row) => clean(row.cardSet)).filter(Boolean))];
  const candidates = [...labels].sort((a, b) => b.length - a.length);

  function mapLabel(label: string) {
    for (const candidate of candidates) {
      if (candidate === label) continue;
      if (label.length <= candidate.length || !label.toLowerCase().startsWith(`${candidate.toLowerCase()} `)) continue;
      if (/^base\b/i.test(candidate) && !baseRootCandidate(candidate)) continue;
      const suffix = clean(label.slice(candidate.length));
      if (looksLikeParallelSuffix(suffix)) {
        return { rootSet: candidate, parallelName: normalizeParallelName(suffix) };
      }
    }
    if (/^Base\s+/i.test(label)) {
      const suffix = clean(label.replace(/^Base\s+/i, ""));
      if (looksLikeParallelSuffix(suffix)) {
        return { rootSet: "Base", parallelName: normalizeParallelName(suffix) };
      }
    }
    return { rootSet: label, parallelName: null };
  }

  return rows.map((row): MappedRow => {
    const mapped = mapLabel(clean(row.cardSet));
    return {
      ...row,
      cardNumber: clean(row.cardNumber).replace(/^#\s*/, ""),
      cardSet: clean(row.cardSet),
      athlete: clean(row.athlete),
      team: clean(row.team),
      position: clean(row.position),
      sequence: clean(row.sequence),
      rootSet: clean(mapped.rootSet),
      parallelName: mapped.parallelName ? clean(mapped.parallelName) : null,
      serialRun: mapped.parallelName ? serialRun(row.sequence) : null,
    };
  });
}

function inferSetType(name: string): ChecklistImportSet["setType"] {
  const value = clean(name).toLowerCase();
  if (/autograph|signature|signed|ink\b/.test(value)) return "autograph";
  if (/memorabilia|jersey|swatch|patch|material|relic/.test(value)) return "memorabilia";
  if (/^base(?:\b|$)/.test(value)) return "base";
  return "insert";
}

function autographStatus(setName: string) {
  return inferSetType(setName) === "autograph" ? "autograph" : "non-auto";
}

function memorabiliaStatus(setName: string) {
  return inferSetType(setName) === "memorabilia" ? "memorabilia" : "non-memorabilia";
}

function buildPlan(config: SourceConfig, sourceBytes: Uint8Array, parsed: ParsedXls) {
  if (parsed.rowCount < 100) {
    throw new Error(`${config.key} parsed only ${parsed.rowCount} checklist rows.`);
  }
  const rows = mapRows(parsed.rows);
  const sets = new Map<string, ChecklistImportSet>();
  const cards = new Map<string, ChecklistImportCard>();
  const parallels = new Map<string, ChecklistImportParallel>();
  const identities: ChecklistImportPlan["identities"] = [];
  const fingerprints = new Set<string>();
  const issues: ChecklistImportValidationIssue[] = [];
  let duplicateIdentityRows = 0;

  for (const row of rows) {
    const players = splitList(row.athlete);
    const teams = splitList(row.team);
    if (!row.cardNumber || !row.rootSet || players.length === 0) {
      throw new Error(`${config.key} contains an incomplete checklist row in ${row.sheet}.`);
    }

    const setSourceKey = comparable(row.rootSet);
    if (!sets.has(setSourceKey)) {
      sets.set(setSourceKey, {
        sourceKey: setSourceKey,
        name: row.rootSet,
        normalizedName: comparable(row.rootSet),
        setType: inferSetType(row.rootSet),
      });
    }

    const cardSourceKey = [
      setSourceKey,
      comparable(row.cardNumber),
      players.map(comparable).sort().join("+"),
      teams.map(comparable).sort().join("+"),
    ].join(":");
    if (!cards.has(cardSourceKey)) {
      cards.set(cardSourceKey, {
        sourceKey: cardSourceKey,
        setSourceKey,
        cardNumber: row.cardNumber,
        players,
        teams,
        rookieDesignation: null,
        firstBowmanDesignation: null,
        autographStatus: autographStatus(row.rootSet),
        memorabiliaStatus: memorabiliaStatus(row.rootSet),
        variation: null,
        sourceNotes: row.position ? `Position: ${row.position}` : null,
      });
    }

    let parallelSourceKey: string | null = null;
    if (row.parallelName) {
      parallelSourceKey = [
        setSourceKey,
        comparable(row.parallelName),
        row.serialRun || 0,
        "",
      ].join(":");
      if (!parallels.has(parallelSourceKey)) {
        parallels.set(parallelSourceKey, {
          sourceKey: parallelSourceKey,
          setSourceKey,
          name: row.parallelName,
          serialRun: row.serialRun,
          configurationExclusivity: null,
        });
      }
    }

    const fingerprint = buildChecklistIdentityFingerprint({
      releaseYear: config.releaseYear,
      manufacturer: "Panini",
      brand: config.brand,
      product: config.product,
      sport: "Basketball",
      league: "WNBA",
      setName: row.rootSet,
      cardNumber: row.cardNumber,
      players,
      teams,
      parallel: row.parallelName,
      serialRun: row.serialRun,
      autographStatus: autographStatus(row.rootSet),
      memorabiliaStatus: memorabiliaStatus(row.rootSet),
    });
    if (fingerprints.has(fingerprint.fingerprintSha256)) {
      duplicateIdentityRows += 1;
      continue;
    }
    fingerprints.add(fingerprint.fingerprintSha256);
    identities.push({ cardSourceKey, parallelSourceKey, fingerprint });
  }

  if (duplicateIdentityRows) {
    issues.push({
      code: "duplicate_source_identity_rows",
      severity: "warning",
      message: `${duplicateIdentityRows} duplicate printed identities were collapsed deterministically.`,
      rowReference: null,
    });
  }
  if (identities.length < Math.floor(parsed.rowCount * 0.8)) {
    throw new Error(
      `${config.key} normalized only ${identities.length}/${parsed.rowCount} unique identities; refusing a lossy import.`,
    );
  }

  const retrievedAt = new Date().toISOString();
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "Panini",
    releaseSlug: config.releaseSlug,
    originalFilename: basename(new URL(config.url).pathname),
    mimeType: "application/vnd.ms-excel",
    content: sourceBytes,
  });

  const plan: ChecklistImportPlan = {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: "panini-gogts-xls-direct",
    adapterVersion: "1.0.0",
    source: {
      sourceUrl: config.url,
      retrievedAt,
      authority: "approved_distributor",
      redistributionAllowed: false,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
    },
    release: {
      manufacturer: "Panini",
      brand: config.brand,
      product: config.product,
      releaseYear: config.releaseYear,
      season: null,
      sport: "Basketball",
      league: "WNBA",
      releaseSlug: config.releaseSlug,
    },
    sets: [...sets.values()],
    cards: [...cards.values()],
    parallels: [...parallels.values()],
    identities,
    validation: {
      status: "passed",
      issues,
      counts: {
        sets: sets.size,
        cards: cards.size,
        parallels: parallels.size,
        identities: identities.length,
      },
    },
  };

  return { plan, mappedRows: rows, duplicateIdentityRows };
}

function requireIdentity(
  config: SourceConfig,
  plan: ChecklistImportPlan,
  expected: { cardNumber: string; player: string; setName: string; parallel: string },
) {
  const player = clean(expected.player).toLowerCase();
  const found = plan.identities.some((identity) => {
    const value = identity.fingerprint.normalized;
    return value.cardNumber === expected.cardNumber.toLowerCase()
      && value.players.includes(player)
      && value.setName === expected.setName.toLowerCase()
      && value.parallel === expected.parallel.toLowerCase();
  });
  if (!found) {
    throw new Error(
      `${config.key} is missing required identity ${expected.player} #${expected.cardNumber} ${expected.setName} ${expected.parallel}.`,
    );
  }
}

async function download(url: string) {
  let last = "download failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.ms-excel,application/octet-stream;q=0.9,*/*;q=0.5",
          "User-Agent": "TruelyCollectables-ChecklistRegistry/1.0",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 1_000) throw new Error(`only ${bytes.byteLength} bytes returned`);
      const magic = Buffer.from(bytes.subarray(0, 8)).toString("hex");
      if (magic !== "d0cf11e0a1b11ae1") {
        throw new Error(`response is not an OLE XLS file (magic ${magic})`);
      }
      return bytes;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
  throw new Error(`Could not download ${url}: ${last}`);
}

function parseXls(path: string) {
  const stdout = execFileSync("python3", [parserPath, path], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(stdout) as ParsedXls;
}

async function main() {
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const receipt: Record<string, unknown> = {
    schema: "tcos.requiredWnbaChecklistImportReceipt.v1",
    startedAt: new Date().toISOString(),
    requiredReleaseCount: SOURCES.length,
    releases: [],
  };
  const releaseReceipts = receipt.releases as Array<Record<string, unknown>>;

  try {
    for (const config of SOURCES) {
      console.log(`[wnba-checklist] downloading ${config.key}`);
      const bytes = await download(config.url);
      const sourceSha256 = sha256(bytes);
      const localPath = join(WORK_DIR, basename(new URL(config.url).pathname));
      writeFileSync(localPath, bytes);
      const parsed = parseXls(localPath);
      const { plan, duplicateIdentityRows } = buildPlan(config, bytes, parsed);

      if (config.key === "2024-prizm-wnba") {
        requireIdentity(config, plan, { cardNumber: "145", player: "Caitlin Clark", setName: "Base", parallel: "Silver" });
        requireIdentity(config, plan, { cardNumber: "116", player: "DeWanna Bonner", setName: "Base", parallel: "Silver" });
      }
      if (config.key === "2025-prizm-wnba") {
        requireIdentity(config, plan, { cardNumber: "32", player: "DeWanna Bonner", setName: "Base", parallel: "Silver" });
      }

      console.log(
        `[wnba-checklist] ${config.key}: ${parsed.rowCount} rows -> ${plan.validation.counts.identities} identities`,
      );
      const response = await postChecklistRegistryAction({
        operation: "import_required_wnba_checklist",
        sourceUrl: config.url,
        sourceSha256,
        originalFilename: basename(localPath),
        sourceBase64: Buffer.from(bytes).toString("base64"),
        plan,
      });
      const result = response.result as Record<string, unknown> | undefined;
      const status = typeof result?.status === "string" ? result.status : "unknown";
      if (!response.ok || !["imported", "unchanged"].includes(status)) {
        throw new Error(`${config.key} production Registry import returned status ${status}.`);
      }

      releaseReceipts.push({
        key: config.key,
        releaseSlug: config.releaseSlug,
        sourceUrl: config.url,
        sourceSha256,
        sourceBytes: bytes.byteLength,
        parsedSheets: parsed.sheetCount,
        parsedRows: parsed.rowCount,
        duplicateIdentityRows,
        normalizedCounts: plan.validation.counts,
        status,
        persistence: result?.persistence || null,
      });
      writeFileSync(OUTPUT, JSON.stringify(receipt, null, 2));
    }

    receipt.completedAt = new Date().toISOString();
    receipt.status = "passed";
    receipt.importedOrUnchanged = releaseReceipts.length;
    writeFileSync(OUTPUT, JSON.stringify(receipt, null, 2));
    console.log(`[wnba-checklist] PASS: ${releaseReceipts.length}/${SOURCES.length} required releases are in Registry.`);
  } catch (error) {
    receipt.completedAt = new Date().toISOString();
    receipt.status = "failed";
    receipt.error = error instanceof Error ? error.message : String(error);
    writeFileSync(OUTPUT, JSON.stringify(receipt, null, 2));
    throw error;
  }
}

await main();
