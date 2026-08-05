import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

const OUTPUT_ROOT = resolve(process.cwd(), process.env.PANINI_ORGANIZED_OUTPUT || ".panini-organized-archive");
const SORTED_ROOT = resolve(OUTPUT_ROOT, "SORTED");
const UNRESOLVED_ROOT = resolve(OUTPUT_ROOT, "UNRESOLVED");
const ALLOWED_EXTENSIONS = new Set([".pdf", ".xls", ".xlsx", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".txt"]);
const TEXT_EXTENSIONS = new Set([".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".txt"]);
const EXCLUDED_FILENAMES = new Set(["manifest.json", "readme.txt", "readme.md", "catalog.json", "catalog.csv"]);

const DEFAULT_INPUTS: Array<{ path: string; source: string }> = [
  { path: ".panini-cardboard-connection-archive/checklists", source: "cardboard-connection" },
  { path: ".panini-beckett-archive/articles", source: "beckett" },
  { path: ".panini-beckett-archive/files", source: "beckett" },
  { path: ".panini-download-now", source: "official-panini" },
  { path: ".panini-archive", source: "official-panini" },
];

type InputRoot = { path: string; source: string };
type Classification = {
  sport: string;
  sportEvidence: string[];
  season: string;
  seasonEvidence: string | null;
  product: string;
  productEvidence: string | null;
  status: "sorted" | "unresolved";
  missing: string[];
};

type CatalogRow = {
  sourcePath: string;
  archivePath: string | null;
  title: string;
  titleOrigin: "embedded-title" | "filename";
  source: string;
  sourceUrl: string | null;
  manufacturer: "Panini";
  sport: string;
  sportEvidence: string[];
  season: string;
  seasonEvidence: string | null;
  product: string;
  productEvidence: string | null;
  classificationStatus: "sorted" | "unresolved" | "duplicate";
  missing: string[];
  duplicateOf: string | null;
  extension: string;
  bytes: number;
  sha256: string;
};

function parseInputs(): InputRoot[] {
  const raw = process.env.PANINI_ARCHIVE_INPUTS?.trim();
  if (!raw) return DEFAULT_INPUTS;
  return raw.split(",").map((entry) => {
    const separator = entry.lastIndexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`Invalid PANINI_ARCHIVE_INPUTS entry: ${entry}`);
    }
    return { path: entry.slice(0, separator).trim(), source: slug(entry.slice(separator + 1).trim()) };
  });
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 160) || "unknown";
}

function safeFilename(value: string) {
  const extension = extname(value).toLowerCase();
  const stem = basename(value, extname(value))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 170) || "checklist";
  return `${stem}${extension}`;
}

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop()!;
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) queue.push(path);
      else if (stat.isFile()) out.push(path);
    }
  }
  return out.sort();
}

function readMetadataText(path: string, extension: string) {
  if (!TEXT_EXTENSIONS.has(extension)) return "";
  const bytes = readFileSync(path);
  return bytes.subarray(0, Math.min(bytes.length, 512_000)).toString("utf8");
}

function embeddedField(text: string, field: string) {
  const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function cleanTitleFromFilename(path: string) {
  return basename(path, extname(path))
    .replace(/^\d{3,6}[-_ ]+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFromUrl(url: string | null, fallback: string) {
  if (!url) return slug(fallback);
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("cardboardconnection.com")) return "cardboard-connection";
    if (host.includes("beckett.com")) return "beckett";
    if (host.includes("paniniamerica")) return "official-panini";
    if (host.includes("web.archive.org")) return "internet-archive";
    if (host.includes("tcdb.com")) return "tcdb";
    if (host.includes("checklistinsider.com")) return "checklist-insider";
    if (host.includes("laststicker.com")) return "last-sticker";
    return slug(host.replace(/^www\./, ""));
  } catch {
    return slug(fallback);
  }
}

const SPORT_RULES: Array<{ sport: string; pattern: RegExp }> = [
  { sport: "baseball", pattern: /\b(baseball|mlb|minor league baseball)\b/i },
  { sport: "basketball", pattern: /\b(basketball|nba|wnba)\b/i },
  { sport: "football", pattern: /\b(football|nfl|xfl|usfl)\b/i },
  { sport: "hockey", pattern: /\b(hockey|nhl)\b/i },
  { sport: "soccer", pattern: /\b(soccer|fifa|uefa|premier league|world cup)\b/i },
  { sport: "racing", pattern: /\b(racing|nascar|indycar|formula one|formula 1|f1)\b/i },
  { sport: "wrestling", pattern: /\b(wrestling|wwe|aew|mlw|ring royalty)\b/i },
  { sport: "mma", pattern: /\b(mma|ufc|pfl|mixed martial arts)\b/i },
  { sport: "boxing", pattern: /\bboxing\b/i },
  { sport: "golf", pattern: /\b(golf|pga|lpga)\b/i },
  { sport: "tennis", pattern: /\btennis\b/i },
  { sport: "entertainment", pattern: /\b(entertainment|non[- ]sport|star wars|marvel|disney|fortnite|movie|music)\b/i },
];

function classifySport(title: string) {
  const explicitMultiSport = /\b(multi[- ]sport|national convention|national silver packs?|father'?s day|black friday|cyber monday)\b/i.test(title);
  if (explicitMultiSport) return { sport: "multi-sport", evidence: ["explicit multi-sport product wording"] };

  const matches = SPORT_RULES.filter((rule) => rule.pattern.test(title));
  if (matches.length === 1) return { sport: matches[0].sport, evidence: [matches[0].pattern.source] };
  if (matches.length > 1) return { sport: "multi-sport", evidence: matches.map((match) => match.sport) };
  return { sport: "UNKNOWN_SPORT", evidence: [] };
}

function classifySeason(title: string) {
  const range = title.match(/\b((?:19|20)\d{2})\s*[-–—\/]\s*((?:19|20)?\d{2})\b/);
  if (range) {
    const first = range[1];
    const second = range[2].length === 2 ? range[2] : range[2].slice(2);
    return { season: `${first}-${second}`, evidence: range[0] };
  }
  const year = title.match(/\b((?:19|20)\d{2})\b/);
  if (year) return { season: year[1], evidence: year[0] };
  return { season: "UNKNOWN_YEAR", evidence: null };
}

function classifyProduct(title: string) {
  let product = title
    .replace(/\s*[-|]\s*(?:The )?Cardboard Connection.*$/i, "")
    .replace(/\s*[-|]\s*Beckett.*$/i, "")
    .replace(/\b(?:19|20)\d{2}\s*[-–—\/]\s*(?:19|20)?\d{2}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\bPanini(?: America)?\b/gi, " ")
    .replace(/\b(?:baseball|basketball|football|hockey|soccer|racing|wrestling|mma|boxing|golf|tennis|nfl|nba|wnba|mlb|nhl|fifa)\b/gi, " ")
    .replace(/\b(?:trading cards?|cards?|checklists?|set info(?:rmation)?|release date|guide|review|details|odds)\b/gi, " ")
    .replace(/[,:|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  product = product.replace(/^[-–— ]+|[-–— ]+$/g, "").trim();
  if (!product || /^(unknown|direct application|download)$/i.test(product)) {
    return { product: "UNKNOWN_PRODUCT", evidence: null };
  }
  return { product: product.slice(0, 120), evidence: product };
}

function classify(title: string): Classification {
  const sport = classifySport(title);
  const season = classifySeason(title);
  const product = classifyProduct(title);
  const missing: string[] = [];
  if (sport.sport === "UNKNOWN_SPORT") missing.push("SPORT");
  if (season.season === "UNKNOWN_YEAR") missing.push("YEAR");
  if (product.product === "UNKNOWN_PRODUCT") missing.push("PRODUCT");
  return {
    sport: sport.sport,
    sportEvidence: sport.evidence,
    season: season.season,
    seasonEvidence: season.evidence,
    product: product.product,
    productEvidence: product.evidence,
    status: missing.length ? "unresolved" : "sorted",
    missing,
  };
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function ensureContained(path: string, root: string) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || rel.includes(`${sep}..${sep}`)) {
    throw new Error(`Archive path escaped output root: ${path}`);
  }
}

function main() {
  mkdirSync(SORTED_ROOT, { recursive: true });
  mkdirSync(UNRESOLVED_ROOT, { recursive: true });

  const inputs = parseInputs();
  const catalog: CatalogRow[] = [];
  const hashes = new Map<string, string>();
  let considered = 0;

  for (const input of inputs) {
    const root = resolve(process.cwd(), input.path);
    for (const path of walk(root)) {
      const extension = extname(path).toLowerCase();
      const lowerName = basename(path).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension) || EXCLUDED_FILENAMES.has(lowerName)) continue;
      considered++;

      const bytes = statSync(path).size;
      const digest = sha256(path);
      const metadata = readMetadataText(path, extension);
      const embeddedTitle = embeddedField(metadata, "TITLE");
      const title = embeddedTitle || cleanTitleFromFilename(path);
      const sourceUrl = embeddedField(metadata, "SOURCE");
      const source = sourceFromUrl(sourceUrl, input.source);
      const classification = classify(title);
      const duplicateOf = hashes.get(digest) || null;

      let archivePath: string | null = null;
      let classificationStatus: CatalogRow["classificationStatus"] = classification.status;
      if (duplicateOf) {
        classificationStatus = "duplicate";
      } else {
        const fileName = `${digest.slice(0, 12)}--${safeFilename(basename(path))}`;
        const destination = classification.status === "sorted"
          ? resolve(SORTED_ROOT, slug(classification.sport), slug(classification.season), slug(classification.product), source, fileName)
          : resolve(UNRESOLVED_ROOT, `MISSING_${classification.missing.join("+")}`, source, fileName);
        ensureContained(destination, OUTPUT_ROOT);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(path, destination);
        archivePath = relative(OUTPUT_ROOT, destination).split(sep).join("/");
        hashes.set(digest, archivePath);
      }

      catalog.push({
        sourcePath: relative(process.cwd(), path).split(sep).join("/"),
        archivePath,
        title,
        titleOrigin: embeddedTitle ? "embedded-title" : "filename",
        source,
        sourceUrl,
        manufacturer: "Panini",
        sport: classification.sport,
        sportEvidence: classification.sportEvidence,
        season: classification.season,
        seasonEvidence: classification.seasonEvidence,
        product: classification.product,
        productEvidence: classification.productEvidence,
        classificationStatus,
        missing: classification.missing,
        duplicateOf,
        extension,
        bytes,
        sha256: digest,
      });
    }
  }

  catalog.sort((a, b) => [a.sport, a.season, a.product, a.source, a.title, a.sourcePath].join("|").localeCompare(
    [b.sport, b.season, b.product, b.source, b.title, b.sourcePath].join("|"),
    undefined,
    { numeric: true, sensitivity: "base" },
  ));

  const totals = {
    inputsConfigured: inputs.length,
    filesConsidered: considered,
    uniqueFiles: catalog.filter((row) => row.classificationStatus !== "duplicate").length,
    sortedFiles: catalog.filter((row) => row.classificationStatus === "sorted").length,
    unresolvedFiles: catalog.filter((row) => row.classificationStatus === "unresolved").length,
    duplicateFiles: catalog.filter((row) => row.classificationStatus === "duplicate").length,
    sports: [...new Set(catalog.filter((row) => row.classificationStatus === "sorted").map((row) => row.sport))].sort(),
    seasons: [...new Set(catalog.filter((row) => row.classificationStatus === "sorted").map((row) => row.season))].sort(),
    products: new Set(catalog.filter((row) => row.classificationStatus === "sorted").map((row) => `${row.sport}|${row.season}|${row.product}`)).size,
  };

  const manifest = {
    schema: "tcos.paniniOrganizedArchive.v1",
    generatedAt: new Date().toISOString(),
    hierarchy: "SORTED/<sport>/<season>/<product>/<source>/<sha-prefix>--<original-file>",
    unresolvedHierarchy: "UNRESOLVED/MISSING_<fields>/<source>/<sha-prefix>--<original-file>",
    policy: [
      "Classification uses only embedded TITLE metadata or the original filename; card-list body text is not used to guess a sport.",
      "Unknown sport, year, or product is quarantined under UNRESOLVED instead of guessed.",
      "Identical bytes are stored once and duplicates point to the canonical archive path by SHA-256.",
      "Original source files are copied unchanged; sorting never rewrites checklist contents.",
    ],
    inputs,
    totals,
    files: catalog,
  };

  writeFileSync(resolve(OUTPUT_ROOT, "catalog.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const headers = [
    "classificationStatus", "sport", "season", "product", "source", "title", "archivePath", "sourcePath",
    "sourceUrl", "missing", "duplicateOf", "extension", "bytes", "sha256",
  ];
  const csv = [headers.map(csvCell).join(",")];
  for (const row of catalog) csv.push(headers.map((header) => csvCell(row[header as keyof CatalogRow])).join(","));
  writeFileSync(resolve(OUTPUT_ROOT, "catalog.csv"), `${csv.join("\n")}\n`);
  writeFileSync(resolve(OUTPUT_ROOT, "README.txt"), [
    "TCOS PANINI CHECKLIST ARCHIVE - SORTING RULES",
    "",
    "SORTED/<sport>/<season>/<product>/<source>/<sha-prefix>--<original-file>",
    "UNRESOLVED/MISSING_<fields>/<source>/<sha-prefix>--<original-file>",
    "",
    "Nothing uncertain is silently guessed. Missing sport, year, or product goes to UNRESOLVED for review.",
    "The original source bytes are preserved and every file is recorded in catalog.json and catalog.csv.",
    "Duplicate bytes are stored once and linked to their canonical archive path by SHA-256.",
    "",
    JSON.stringify(totals, null, 2),
    "",
  ].join("\n"));

  console.log(JSON.stringify(totals));
  if (considered === 0) throw new Error("No checklist files were found in any configured input root.");
  if (totals.uniqueFiles !== totals.sortedFiles + totals.unresolvedFiles) throw new Error("Organizer count reconciliation failed.");
  if (catalog.some((row) => row.classificationStatus === "sorted" && (!row.archivePath || row.missing.length))) {
    throw new Error("A sorted file is missing a valid archive path or still has unresolved fields.");
  }
}

main();
