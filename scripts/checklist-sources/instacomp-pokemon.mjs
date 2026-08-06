import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = "instacomp-pokemon";
const ROOT = resolve(
  process.cwd(),
  process.env.CHECKLIST_OUTPUT_ROOT || `.internal-checklist-source-archive/${SOURCE}`,
);
const ITEMS = resolve(ROOT, "items");
const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/$/, "");
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const PAGE_SIZE = Math.max(100, Math.min(Number(process.env.INSTACOMP_POKEMON_PAGE_SIZE || 1000), 1000));
const MAX_RELEASES = Math.max(1, Math.min(Number(process.env.INSTACOMP_POKEMON_MAX_RELEASES || 5000), 10000));

function slug(value, max = 180) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, max) || "unknown";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, payload);
  return { payload, bytes: Buffer.byteLength(payload), sha256: sha256(payload) };
}

function relation(value) {
  if (Array.isArray(value)) return value[0] || {};
  return value && typeof value === "object" ? value : {};
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pokemonSetRow(row) {
  const release = relation(row.release);
  const haystack = [
    row.name,
    row.normalized_name,
    release.product_name,
    relation(release.manufacturer).name,
    relation(release.brand).name,
    relation(release.sport).name,
    relation(release.league).name,
  ]
    .map(text)
    .join(" ");
  return /\bpok[eé]mon\b/i.test(haystack);
}

function restHeaders(range) {
  return {
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    accept: "application/json",
    "range-unit": "items",
    range,
  };
}

async function fetchAll(table, select, filters = {}) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== null && value !== undefined && String(value) !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      headers: restHeaders(`${start}-${start + PAGE_SIZE - 1}`),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`${table} HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`${table} did not return an array.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function sourceFailure(error) {
  mkdirSync(ITEMS, { recursive: true });
  const manifest = {
    schema: "tcos.internalChecklistSourceArchive.v1",
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    collectionOutcome: "failed",
    database: "InstaComp Checklist Registry",
    universe: "pokemon",
    totals: {
      discoveredCandidates: 0,
      archivedItems: 0,
      checklistItems: 0,
      setIndexOnlyItems: 0,
      checklistRows: 0,
    },
    failures: [{ stage: "instacomp-pokemon-export", error: String(error?.message || error) }],
  };
  writeJson(resolve(ROOT, "manifest.json"), manifest);
  writeFileSync(
    resolve(ROOT, "README.txt"),
    "InstaComp Pokemon export failed. This receipt prevents the universal card database from silently claiming Pokemon coverage.\n",
  );
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const setRows = await fetchAll(
    "checklist_sets",
    [
      "id",
      "name",
      "normalized_name",
      "release_id",
      "version_id",
      "version:checklist_versions!inner(id,is_active,status)",
      "release:checklist_releases!inner(id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name))",
    ].join(","),
    {
      "version.is_active": "eq.true",
      "version.status": "eq.live",
    },
  );

  const pokemonSets = setRows.filter(pokemonSetRow);
  const groups = new Map();
  for (const setRow of pokemonSets) {
    const release = relation(setRow.release);
    const version = relation(setRow.version);
    const releaseId = text(setRow.release_id || release.id);
    const versionId = text(setRow.version_id || version.id);
    if (!releaseId || !versionId) continue;
    const key = `${releaseId}|${versionId}`;
    const current = groups.get(key) || { releaseId, versionId, release, version, sets: [] };
    current.sets.push({
      id: setRow.id,
      name: setRow.name,
      normalizedName: setRow.normalized_name,
    });
    groups.set(key, current);
  }

  const releases = [...groups.values()].slice(0, MAX_RELEASES);
  if (!releases.length) throw new Error("No active live Pokemon releases were found in InstaComp's checklist_* Registry tables.");

  const items = [];
  let totalCards = 0;
  for (const group of releases) {
    const cards = await fetchAll(
      "checklist_cards",
      [
        "id",
        "set_id",
        "release_id",
        "version_id",
        "card_number",
        "normalized_card_number",
        "variation",
        "autograph_status",
        "memorabilia_status",
      ].join(","),
      {
        release_id: `eq.${group.releaseId}`,
        version_id: `eq.${group.versionId}`,
      },
    );

    const release = group.release;
    const manufacturer = text(relation(release.manufacturer).name) || "The Pokemon Company";
    const brand = text(relation(release.brand).name) || "Pokemon";
    const season = text(release.release_year || release.season);
    const product = text(release.product_name) || text(group.sets[0]?.name) || "Pokemon";
    const id = `${slug(season)}--${slug(manufacturer)}--${slug(product)}--${slug(group.releaseId, 48)}`;
    const dir = resolve(ITEMS, id);
    mkdirSync(dir, { recursive: true });

    const checklist = {
      schema: "tcos.instacompPokemonChecklistExport.v1",
      exportedAt: new Date().toISOString(),
      universe: "pokemon",
      source: "InstaComp Checklist Registry",
      release: {
        id: group.releaseId,
        versionId: group.versionId,
        season: season || null,
        manufacturer,
        brand,
        product,
      },
      sets: group.sets,
      cards,
    };
    const checklistFile = writeJson(resolve(dir, "checklist.json"), checklist);
    const metadata = {
      schema: "tcos.internalChecklistSourceItem.v1",
      id,
      source: SOURCE,
      sourceUrl: `tcos://instacomp/checklist-registry/pokemon/releases/${group.releaseId}/versions/${group.versionId}`,
      title: [season, brand, product, "Pokemon"].filter(Boolean).join(" "),
      universe: "pokemon",
      sport: null,
      season: season || null,
      manufacturer,
      product,
      sourceRevision: group.versionId,
      sourceCategories: ["internal-instacomp-checklist-registry", "pokemon"],
      status: cards.length ? "checklist-saved" : "set-index-only",
      checklistRows: cards.length,
      retrievedAt: new Date().toISOString(),
      files: [
        {
          name: "checklist.json",
          role: "internal-checklist-registry-export",
          bytes: checklistFile.bytes,
          sha256: checklistFile.sha256,
        },
      ],
      policy: "Internal InstaComp Checklist Registry export. Included in the same universal card database; no card images are exported.",
    };
    writeJson(resolve(dir, "metadata.json"), metadata);
    items.push(metadata);
    totalCards += cards.length;
  }

  const manifest = {
    schema: "tcos.internalChecklistSourceArchive.v1",
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    collectionOutcome: "success",
    database: "InstaComp Checklist Registry",
    universe: "pokemon",
    policy: "Pokemon is a first-class universe in the same universal card database. InstaComp is the source system, not a separate final catalog.",
    totals: {
      discoveredCandidates: pokemonSets.length,
      archivedItems: items.length,
      checklistItems: items.filter((item) => item.checklistRows > 0).length,
      setIndexOnlyItems: items.filter((item) => item.checklistRows === 0).length,
      checklistRows: totalCards,
      activeLiveSets: pokemonSets.length,
    },
    items,
    failures: [],
  };
  writeJson(resolve(ROOT, "manifest.json"), manifest);
  writeFileSync(
    resolve(ROOT, "README.txt"),
    [
      "INSTACOMP POKEMON CHECKLIST REGISTRY EXPORT",
      "",
      "Pokemon is included in the same universal card database as sports, entertainment, non-sport, and other TCG universes.",
      "It is classified under universe=pokemon and sport=null.",
      "No images are exported.",
      "",
      JSON.stringify(manifest.totals, null, 2),
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify(manifest.totals));
}

main().catch((error) => {
  console.error(error);
  sourceFailure(error);
  process.exitCode = 1;
});
