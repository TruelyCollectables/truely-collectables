import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const MASTER_ROOT = resolve(process.cwd(), process.env.CHECKLIST_MASTER_ROOT || ".card-checklist-master-archive");
const OUT = resolve(MASTER_ROOT, "phase1-mainstream-2000-plus");
const START_YEAR = Number(process.env.CHECKLIST_PHASE1_START_YEAR || 2000);
const END_YEAR = Number(process.env.CHECKLIST_PHASE1_END_YEAR || new Date().getUTCFullYear());
const REQUIRE_INSTACOMP_POKEMON = process.env.REQUIRE_INSTACOMP_POKEMON === "true";

const TARGET_UNIVERSES = [
  "baseball", "basketball", "football", "hockey", "soccer", "racing", "wrestling",
  "mma", "boxing", "golf", "tennis", "multi-sport", "non-sport", "entertainment",
  "pokemon", "magic-the-gathering", "yu-gi-oh", "lorcana", "other-tcg",
];

const SPORT_ALIASES = new Map([
  ["baseball", "baseball"], ["mlb", "baseball"],
  ["basketball", "basketball"], ["nba", "basketball"], ["wnba", "basketball"],
  ["football", "football"], ["nfl", "football"], ["xfl", "football"], ["usfl", "football"],
  ["hockey", "hockey"], ["nhl", "hockey"],
  ["soccer", "soccer"], ["football-soccer", "soccer"],
  ["racing", "racing"], ["nascar", "racing"], ["formula-one", "racing"],
  ["wrestling", "wrestling"], ["wwe", "wrestling"], ["aew", "wrestling"],
  ["mma", "mma"], ["ufc", "mma"], ["pfl", "mma"],
  ["boxing", "boxing"], ["golf", "golf"], ["tennis", "tennis"],
  ["multi-sport", "multi-sport"], ["multisport", "multi-sport"],
  ["non-sport", "non-sport"], ["nonsport", "non-sport"], ["entertainment", "entertainment"],
  ["pokemon", "pokemon"], ["pokémon", "pokemon"],
]);

const DEFER_KEYWORDS = [
  /\bpromo(?:tional)?\b/i, /\bsample\b/i, /\bproof\b/i, /\btest issue\b/i,
  /\bconvention\b/i, /\bnational silver packs?\b/i, /\bteam[- ]issued\b/i,
  /\bregional\b/i, /\bfood issue\b/i, /\bcereal\b/i, /\brestaurant\b/i,
  /\bmail[- ]in\b/i, /\bpostcards?\b/i, /\bstamps?\b/i, /\bcoins?\b/i,
  /\bdiscs?\b/i, /\bwrappers?\b/i, /\buncut\b/i, /\bodd[- ]?ball\b/i,
];

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function seasonStart(value) {
  const match = String(value || "").match(/\b((?:18|19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function inferUniverse(row) {
  const explicit = slug(row.universe);
  if (explicit) return SPORT_ALIASES.get(explicit) || explicit;
  const rawSport = slug(row.sport);
  if (SPORT_ALIASES.has(rawSport)) return SPORT_ALIASES.get(rawSport);
  const text = `${row.title || ""} ${row.manufacturer || ""} ${row.product || ""}`.toLowerCase();
  if (/\bpok[eé]mon\b/.test(text)) return "pokemon";
  if (/\bmagic(?: the gathering|: the gathering| mtg)?\b/.test(text)) return "magic-the-gathering";
  if (/\byu-?gi-?oh\b/.test(text)) return "yu-gi-oh";
  if (/\blorcana\b/.test(text)) return "lorcana";
  if (/\b(?:star wars|marvel|dc comics|disney|pixar|doctor who|star trek|harry potter|lord of the rings|game of thrones|garbage pail|entertainment)\b/.test(text)) return "entertainment";
  if (/\b(?:tcg|trading card game|collectible card game|ccg)\b/.test(text)) return "other-tcg";
  return rawSport || "unresolved";
}

function deferredReason(row) {
  const text = `${row.title || ""} ${row.product || ""}`;
  const matched = DEFER_KEYWORDS.find((pattern) => pattern.test(text));
  return matched ? matched.source : null;
}

function readiness(row) {
  const rows = Number(row.checklistRowsMaximum || 0);
  const sources = Number(row.sourceCount || 0);
  if (rows > 0 && sources > 1) return "CHECKLIST_PRESENT_MULTI_SOURCE";
  if (rows > 0) return "CHECKLIST_PRESENT_SINGLE_SOURCE";
  if (sources > 1) return "SET_IDENTITY_MULTI_SOURCE_NO_ROWS";
  return "SET_INDEX_ONLY";
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const masterSets = JSON.parse(readFileSync(resolve(MASTER_ROOT, "master-sets.json"), "utf8"));
  const sourceItems = JSON.parse(readFileSync(resolve(MASTER_ROOT, "source-items.json"), "utf8"));

  const enriched = masterSets.map((row) => {
    const year = seasonStart(row.season);
    const universe = inferUniverse(row);
    const defer = deferredReason(row);
    const inYearRange = year != null && year >= START_YEAR && year <= END_YEAR;
    return {
      ...row,
      year,
      universe,
      phase1Status: inYearRange && TARGET_UNIVERSES.includes(universe) && !defer
        ? "IN_SCOPE_MAINSTREAM_2000_PLUS"
        : defer
          ? "DEFERRED_ODDBALL_OR_ONE_OFF"
          : "OUT_OF_PHASE1_SCOPE",
      deferredReason: defer,
      readiness: readiness(row),
    };
  });

  const mainstream = enriched.filter((row) => row.phase1Status === "IN_SCOPE_MAINSTREAM_2000_PLUS");
  const pokemon = mainstream.filter((row) => row.universe === "pokemon");
  const pokemonFromInstaComp = pokemon.filter((row) => Array.isArray(row.sources) && row.sources.includes("instacomp-pokemon"));
  const deferred = enriched.filter((row) => row.phase1Status === "DEFERRED_ODDBALL_OR_ONE_OFF");
  const coverage = [];

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    for (const universe of TARGET_UNIVERSES) {
      const rows = mainstream.filter((row) => row.year === year && row.universe === universe);
      coverage.push({
        year,
        universe,
        exactSets: rows.length,
        setsWithChecklistRows: rows.filter((row) => Number(row.checklistRowsMaximum || 0) > 0).length,
        setsWithMultipleSources: rows.filter((row) => Number(row.sourceCount || 0) > 1).length,
        setIndexOnly: rows.filter((row) => row.readiness === "SET_INDEX_ONLY").length,
        manufacturers: [...new Set(rows.map((row) => row.manufacturer).filter(Boolean))].sort(),
        coverageStatus: rows.length === 0
          ? "NO_SETS_FOUND"
          : rows.some((row) => Number(row.checklistRowsMaximum || 0) > 0)
            ? "CHECKLIST_COVERAGE_PRESENT"
            : "IDENTITIES_ONLY",
      });
    }
  }

  const unresolvedSourceItems = sourceItems.filter((row) => row.classificationStatus === "unresolved");
  const totals = {
    phase: "MAINSTREAM_2000_PLUS",
    startYear: START_YEAR,
    endYear: END_YEAR,
    targetUniverses: TARGET_UNIVERSES,
    exactMasterSetsAllYears: masterSets.length,
    inScopeExactSets: mainstream.length,
    inScopeSetsWithChecklistRows: mainstream.filter((row) => Number(row.checklistRowsMaximum || 0) > 0).length,
    inScopeSetsWithMultipleSources: mainstream.filter((row) => Number(row.sourceCount || 0) > 1).length,
    inScopeSetIndexOnly: mainstream.filter((row) => row.readiness === "SET_INDEX_ONLY").length,
    pokemonExactSets: pokemon.length,
    pokemonSetsWithChecklistRows: pokemon.filter((row) => Number(row.checklistRowsMaximum || 0) > 0).length,
    pokemonInstaCompSourceSets: pokemonFromInstaComp.length,
    pokemonDatabaseStatus: pokemonFromInstaComp.length ? "INCLUDED_IN_SAME_MASTER_DATABASE" : "MISSING_INSTACOMP_POKEMON_SOURCE",
    deferredOddballOrOneOff: deferred.length,
    unresolvedSourceItems: unresolvedSourceItems.length,
    emptyYearUniverseCells: coverage.filter((row) => row.coverageStatus === "NO_SETS_FOUND").length,
    identityOnlyYearUniverseCells: coverage.filter((row) => row.coverageStatus === "IDENTITIES_ONLY").length,
  };

  writeFileSync(resolve(OUT, "manifest.json"), `${JSON.stringify({
    schema: "tcos.mainstream2000PlusCoverage.v4",
    generatedAt: new Date().toISOString(),
    scopeRule: "Years 2000-current, mainstream sports, Pokemon, entertainment, non-sport, stickers, and major TCG releases in one universal card database.",
    completenessRule: "A set is not considered checklist-ready unless checklistRowsMaximum is greater than zero. Multi-source corroboration is tracked separately.",
    pokemonRule: "Pokemon is a first-class universe in this same master database. InstaComp Checklist Registry is its source system; Pokemon is not classified as a sport and is not omitted into a sidecar database.",
    totals,
  }, null, 2)}\n`);
  writeFileSync(resolve(OUT, "mainstream-sets.json"), `${JSON.stringify(mainstream, null, 2)}\n`);
  writeFileSync(resolve(OUT, "pokemon-sets.json"), `${JSON.stringify(pokemon, null, 2)}\n`);
  writeFileSync(resolve(OUT, "deferred-sets.json"), `${JSON.stringify(deferred, null, 2)}\n`);
  writeFileSync(resolve(OUT, "coverage-by-year-universe.json"), `${JSON.stringify(coverage, null, 2)}\n`);

  const setHeaders = ["year", "universe", "sport", "season", "manufacturer", "product", "sourceCount", "itemCount", "checklistRowsMaximum", "readiness", "sources", "exactSetKey"];
  const setCsv = [setHeaders.map(csvCell).join(",")];
  for (const row of mainstream) setCsv.push(setHeaders.map((header) => csvCell(row[header])).join(","));
  writeFileSync(resolve(OUT, "mainstream-sets.csv"), `${setCsv.join("\n")}\n`);

  const pokemonCsv = [setHeaders.map(csvCell).join(",")];
  for (const row of pokemon) pokemonCsv.push(setHeaders.map((header) => csvCell(row[header])).join(","));
  writeFileSync(resolve(OUT, "pokemon-sets.csv"), `${pokemonCsv.join("\n")}\n`);

  const coverageHeaders = ["year", "universe", "exactSets", "setsWithChecklistRows", "setsWithMultipleSources", "setIndexOnly", "coverageStatus", "manufacturers"];
  const coverageCsv = [coverageHeaders.map(csvCell).join(",")];
  for (const row of coverage) coverageCsv.push(coverageHeaders.map((header) => csvCell(row[header])).join(","));
  writeFileSync(resolve(OUT, "coverage-by-year-universe.csv"), `${coverageCsv.join("\n")}\n`);

  const gaps = coverage.filter((row) => row.coverageStatus !== "CHECKLIST_COVERAGE_PRESENT");
  writeFileSync(resolve(OUT, "gap-report.md"), [
    "# TCOS Phase 1 — Universal Card Database Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Pokemon inclusion",
    "",
    `Pokemon is included in the same master database under universe=pokemon and sport=null. InstaComp-backed Pokemon sets found: ${pokemonFromInstaComp.length}.`,
    "",
    "## Totals",
    "",
    "```json",
    JSON.stringify(totals, null, 2),
    "```",
    "",
    "## Coverage gaps",
    "",
    ...gaps.map((row) => `- ${row.year} — ${row.universe}: ${row.coverageStatus} (${row.exactSets} set identities, ${row.setsWithChecklistRows} with checklist rows)`),
    "",
    "## Deferred Phase 2 material",
    "",
    `Explicit oddball, promotional, regional, food, convention, test, proof, mail-in, postcard, stamp, coin, disc, wrapper, and uncut issues deferred: ${deferred.length}.`,
    "",
  ].join("\n"));

  console.log(JSON.stringify(totals));
  if (!mainstream.length) throw new Error("No Phase 1 mainstream 2000+ sets were found.");
  if (REQUIRE_INSTACOMP_POKEMON && !pokemonFromInstaComp.length) {
    throw new Error("Pokemon is required in the same master database, but no InstaComp Pokemon source sets were merged.");
  }
}

main();
