import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

const OUTPUT_ROOT = resolve(process.cwd(), process.env.CHECKLIST_ORGANIZED_OUTPUT || ".universal-card-checklist-archive");
const SORTED_ROOT = resolve(OUTPUT_ROOT, "SORTED");
const UNRESOLVED_ROOT = resolve(OUTPUT_ROOT, "UNRESOLVED");
const INPUTS = parseInputs(process.env.CHECKLIST_ARCHIVE_INPUTS || "");
const ACCEPTED_ITEM_SCHEMAS = new Set([
  "tcos.publicChecklistSourceItem.v1",
  "tcos.internalChecklistSourceItem.v1",
]);
const SPORTS_UNIVERSES = new Set([
  "baseball", "basketball", "football", "hockey", "soccer", "racing", "wrestling",
  "mma", "boxing", "golf", "tennis", "multi-sport",
]);

function parseInputs(raw) {
  if (!raw.trim()) throw new Error("CHECKLIST_ARCHIVE_INPUTS is required as path=source,path=source");
  return raw.split(",").map((entry) => {
    const index = entry.lastIndexOf("=");
    if (index <= 0 || index === entry.length - 1) throw new Error(`Invalid input entry: ${entry}`);
    return { path: resolve(process.cwd(), entry.slice(0, index).trim()), source: slug(entry.slice(index + 1).trim()) };
  });
}

function slug(value, max = 160) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, max) || "unknown";
}

function walk(root, filename) {
  if (!existsSync(root)) return [];
  const out = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) queue.push(path);
      else if (stat.isFile() && name === filename) out.push(path);
    }
  }
  return out.sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureContained(path) {
  const rel = relative(OUTPUT_ROOT, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`)) {
    throw new Error(`Output path escaped archive root: ${path}`);
  }
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function universeFor(item) {
  return item.universe || item.sport || null;
}

function sportFor(item, universe) {
  if (item.sport) return item.sport;
  return SPORTS_UNIVERSES.has(slug(universe)) ? universe : null;
}

function exactSetKey(item) {
  const universe = universeFor(item);
  if (!universe || !item.season || !item.manufacturer || !item.product) return null;
  return [universe, item.season, item.manufacturer, item.product].map((value) => slug(value)).join("|");
}

function main() {
  mkdirSync(SORTED_ROOT, { recursive: true });
  mkdirSync(UNRESOLVED_ROOT, { recursive: true });

  const sourceItems = [];
  const fileHashes = new Map();
  const exactSets = new Map();

  for (const input of INPUTS) {
    for (const metadataPath of walk(input.path, "metadata.json")) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      if (!ACCEPTED_ITEM_SCHEMAS.has(metadata.schema)) continue;
      const source = slug(metadata.source || input.source);
      const universe = universeFor(metadata);
      const sport = sportFor(metadata, universe);
      const missing = [];
      if (!universe) missing.push("UNIVERSE");
      if (!metadata.season) missing.push("YEAR");
      if (!metadata.manufacturer) missing.push("MANUFACTURER");
      if (!metadata.product) missing.push("PRODUCT");
      const classificationStatus = missing.length ? "unresolved" : "sorted";
      const itemId = slug(metadata.id || basename(dirname(metadataPath)), 190);
      const destination = classificationStatus === "sorted"
        ? resolve(SORTED_ROOT, slug(universe), slug(metadata.season), slug(metadata.manufacturer), slug(metadata.product), source, itemId)
        : resolve(UNRESOLVED_ROOT, `MISSING_${missing.join("+")}`, source, itemId);
      ensureContained(destination);
      mkdirSync(destination, { recursive: true });

      const copiedFiles = [];
      const metadataCopy = resolve(destination, "metadata.json");
      copyFileSync(metadataPath, metadataCopy);
      copiedFiles.push({ name: "metadata.json", role: "metadata", sha256: sha256(metadataCopy), bytes: statSync(metadataCopy).size, duplicateOf: null });

      for (const file of metadata.files || []) {
        const sourcePath = resolve(dirname(metadataPath), basename(file.name));
        if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) continue;
        const digest = sha256(sourcePath);
        const canonical = fileHashes.get(digest) || null;
        const destinationPath = resolve(destination, basename(file.name));
        ensureContained(destinationPath);
        if (canonical) {
          writeFileSync(`${destinationPath}.DUPLICATE-OF.txt`, `${canonical}\n`);
          copiedFiles.push({ name: `${basename(file.name)}.DUPLICATE-OF.txt`, role: file.role || null, sha256: digest, bytes: statSync(sourcePath).size, duplicateOf: canonical });
        } else {
          copyFileSync(sourcePath, destinationPath);
          const archivePath = relative(OUTPUT_ROOT, destinationPath).split(sep).join("/");
          fileHashes.set(digest, archivePath);
          copiedFiles.push({ name: basename(file.name), role: file.role || null, sha256: digest, bytes: statSync(sourcePath).size, duplicateOf: null });
        }
      }

      const archivePath = relative(OUTPUT_ROOT, destination).split(sep).join("/");
      const key = exactSetKey(metadata);
      const row = {
        id: metadata.id,
        title: metadata.title,
        universe: universe || null,
        sport,
        season: metadata.season || null,
        manufacturer: metadata.manufacturer || null,
        product: metadata.product || null,
        source,
        sourceUrl: metadata.sourceUrl || null,
        sourceRevision: metadata.sourceRevision || null,
        status: metadata.status || null,
        checklistRows: Number(metadata.checklistRows || 0),
        classificationStatus,
        missing,
        exactSetKey: key,
        archivePath,
        files: copiedFiles,
      };
      sourceItems.push(row);

      if (key) {
        const existing = exactSets.get(key) || {
          exactSetKey: key,
          universe,
          sport,
          season: metadata.season,
          manufacturer: metadata.manufacturer,
          product: metadata.product,
          sourceCount: 0,
          sources: [],
          itemCount: 0,
          checklistRowsMaximum: 0,
          sourceItems: [],
        };
        existing.itemCount += 1;
        existing.checklistRowsMaximum = Math.max(existing.checklistRowsMaximum, Number(metadata.checklistRows || 0));
        existing.sourceItems.push({ source, id: metadata.id, title: metadata.title, sourceUrl: metadata.sourceUrl || null, status: metadata.status || null, archivePath });
        if (!existing.sources.includes(source)) existing.sources.push(source);
        existing.sourceCount = existing.sources.length;
        exactSets.set(key, existing);
      }
    }
  }

  sourceItems.sort((a, b) => [a.universe, a.season, a.manufacturer, a.product, a.source, a.title].join("|").localeCompare(
    [b.universe, b.season, b.manufacturer, b.product, b.source, b.title].join("|"), undefined, { numeric: true, sensitivity: "base" },
  ));
  const masterSets = [...exactSets.values()].sort((a, b) => [a.universe, a.season, a.manufacturer, a.product].join("|").localeCompare(
    [b.universe, b.season, b.manufacturer, b.product].join("|"), undefined, { numeric: true, sensitivity: "base" },
  ));

  const totals = {
    inputSources: INPUTS.length,
    sourceItems: sourceItems.length,
    sortedSourceItems: sourceItems.filter((row) => row.classificationStatus === "sorted").length,
    unresolvedSourceItems: sourceItems.filter((row) => row.classificationStatus === "unresolved").length,
    exactMasterSets: masterSets.length,
    setsCoveredByMultipleSources: masterSets.filter((row) => row.sourceCount > 1).length,
    uniqueStoredFileHashes: fileHashes.size,
    universes: [...new Set(masterSets.map((row) => row.universe))].sort(),
    sports: [...new Set(masterSets.map((row) => row.sport).filter(Boolean))].sort(),
    seasons: [...new Set(masterSets.map((row) => row.season))].sort(),
    manufacturers: [...new Set(masterSets.map((row) => row.manufacturer))].sort(),
  };

  const manifest = {
    schema: "tcos.universalCardChecklistArchive.v2",
    generatedAt: new Date().toISOString(),
    hierarchy: "SORTED/<universe>/<season>/<manufacturer>/<product>/<source>/<source-item-id>",
    unresolvedHierarchy: "UNRESOLVED/MISSING_<fields>/<source>/<source-item-id>",
    mergeRule: "Source records merge into one master set only when normalized universe, season, manufacturer, and product all match exactly. No fuzzy merges.",
    universePolicy: "Sports, Pokemon, entertainment, non-sport, and other TCG families are peers in one card database. Sport is populated only for sports universes.",
    manufacturerPolicy: "Manufacturer is the maker or printed brand explicitly supplied by the source. Corporate ownership is not silently rewritten across eras.",
    inputs: INPUTS.map((input) => ({ path: relative(process.cwd(), input.path).split(sep).join("/"), source: input.source })),
    totals,
  };

  writeFileSync(resolve(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_ROOT, "source-items.json"), `${JSON.stringify(sourceItems, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_ROOT, "master-sets.json"), `${JSON.stringify(masterSets, null, 2)}\n`);

  const itemHeaders = ["classificationStatus", "universe", "sport", "season", "manufacturer", "product", "source", "title", "status", "checklistRows", "sourceUrl", "archivePath", "missing", "exactSetKey"];
  const itemCsv = [itemHeaders.map(csvCell).join(",")];
  for (const row of sourceItems) itemCsv.push(itemHeaders.map((header) => csvCell(row[header])).join(","));
  writeFileSync(resolve(OUTPUT_ROOT, "source-items.csv"), `${itemCsv.join("\n")}\n`);

  const setHeaders = ["universe", "sport", "season", "manufacturer", "product", "sourceCount", "itemCount", "checklistRowsMaximum", "sources", "exactSetKey"];
  const setCsv = [setHeaders.map(csvCell).join(",")];
  for (const row of masterSets) setCsv.push(setHeaders.map((header) => csvCell(row[header])).join(","));
  writeFileSync(resolve(OUTPUT_ROOT, "master-sets.csv"), `${setCsv.join("\n")}\n`);

  writeFileSync(resolve(OUTPUT_ROOT, "README.txt"), [
    "TCOS UNIVERSAL CARD CHECKLIST ARCHIVE",
    "",
    "SORTED/<universe>/<season>/<manufacturer>/<product>/<source>/<source-item-id>",
    "UNRESOLVED/MISSING_<fields>/<source>/<source-item-id>",
    "",
    "Pokemon, sports, entertainment, non-sport, and other TCG releases live in this same master database.",
    "Pokemon uses universe=pokemon and sport=null; it is not hidden in a sports category or separated into another final database.",
    "No fuzzy set merging is permitted. A master set is formed only when universe, season, manufacturer, and product match exactly.",
    "Unknown fields are quarantined rather than guessed. Original source files are preserved; identical file bytes are stored once by SHA-256.",
    "",
    JSON.stringify(totals, null, 2),
    "",
  ].join("\n"));

  console.log(JSON.stringify(totals));
  if (!sourceItems.length) throw new Error("No source item metadata files were found.");
  if (totals.sourceItems !== totals.sortedSourceItems + totals.unresolvedSourceItems) throw new Error("Archive reconciliation failed.");
}

main();
