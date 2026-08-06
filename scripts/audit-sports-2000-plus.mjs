import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MASTER_ROOT = resolve(
  process.cwd(),
  process.env.CHECKLIST_MASTER_ROOT || ".card-checklist-master-archive",
);
const OUT = resolve(MASTER_ROOT, "phase1-sports-2000-plus");
const START_YEAR = Number(process.env.CHECKLIST_PHASE1_START_YEAR || 2000);
const END_YEAR = Number(
  process.env.CHECKLIST_PHASE1_END_YEAR || new Date().getUTCFullYear(),
);

const SPORTS = [
  "baseball",
  "basketball",
  "football",
  "hockey",
  "soccer",
  "racing",
  "wrestling",
  "mma",
  "boxing",
  "golf",
  "tennis",
  "multi-sport",
];

const SPORT_ALIASES = new Map([
  ["baseball", "baseball"],
  ["mlb", "baseball"],
  ["basketball", "basketball"],
  ["nba", "basketball"],
  ["wnba", "basketball"],
  ["football", "football"],
  ["nfl", "football"],
  ["xfl", "football"],
  ["usfl", "football"],
  ["hockey", "hockey"],
  ["nhl", "hockey"],
  ["soccer", "soccer"],
  ["football-soccer", "soccer"],
  ["racing", "racing"],
  ["nascar", "racing"],
  ["formula-one", "racing"],
  ["wrestling", "wrestling"],
  ["wwe", "wrestling"],
  ["aew", "wrestling"],
  ["mma", "mma"],
  ["ufc", "mma"],
  ["pfl", "mma"],
  ["boxing", "boxing"],
  ["golf", "golf"],
  ["tennis", "tennis"],
  ["multi-sport", "multi-sport"],
  ["multisport", "multi-sport"],
]);

const DEFER_KEYWORDS = [
  /\bpromo(?:tional)?\b/i,
  /\bsample\b/i,
  /\bproof\b/i,
  /\btest issue\b/i,
  /\bconvention\b/i,
  /\bnational silver packs?\b/i,
  /\bteam[- ]issued\b/i,
  /\bregional\b/i,
  /\bfood issue\b/i,
  /\bcereal\b/i,
  /\brestaurant\b/i,
  /\bmail[- ]in\b/i,
  /\bpostcards?\b/i,
  /\bstamps?\b/i,
  /\bcoins?\b/i,
  /\bdiscs?\b/i,
  /\bwrappers?\b/i,
  /\buncut\b/i,
  /\bodd[- ]?ball\b/i,
];

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function csvCell(value) {
  const text = Array.isArray(value)
    ? value.join("|")
    : value == null
      ? ""
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function seasonStart(value) {
  const match = String(value || "").match(/\b((?:18|19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function inferSport(row) {
  const explicit = slug(row.sport || row.universe);
  if (SPORT_ALIASES.has(explicit)) return SPORT_ALIASES.get(explicit);

  const text = `${row.title || ""} ${row.manufacturer || ""} ${row.product || ""}`.toLowerCase();
  if (/\b(?:baseball|mlb|bowman)\b/.test(text)) return "baseball";
  if (/\b(?:basketball|nba|wnba|hoops)\b/.test(text)) return "basketball";
  if (/\b(?:football|nfl|xfl|usfl|gridiron)\b/.test(text)) return "football";
  if (/\b(?:hockey|nhl|ahl|chl|pwhl|o-pee-chee|parkhurst)\b/.test(text)) return "hockey";
  if (/\b(?:soccer|fifa|uefa|mls|premier league)\b/.test(text)) return "soccer";
  if (/\b(?:racing|nascar|formula[- ]?1|f1)\b/.test(text)) return "racing";
  if (/\b(?:wrestling|wwe|aew)\b/.test(text)) return "wrestling";
  if (/\b(?:mma|ufc|pfl)\b/.test(text)) return "mma";
  if (/\bboxing\b/.test(text)) return "boxing";
  if (/\bgolf\b/.test(text)) return "golf";
  if (/\btennis\b/.test(text)) return "tennis";
  if (/\b(?:multi[- ]?sport|national vip|father'?s day|black friday|sports heroes)\b/.test(text)) {
    return "multi-sport";
  }
  return explicit || "unresolved";
}

function deferredReason(row) {
  const text = `${row.title || ""} ${row.product || ""}`;
  const matched = DEFER_KEYWORDS.find((pattern) => pattern.test(text));
  return matched ? matched.source : null;
}

function readiness(row) {
  const checklistRows = Number(row.checklistRowsMaximum || 0);
  const sources = Number(row.sourceCount || 0);
  if (checklistRows > 0 && sources > 1) return "CHECKLIST_PRESENT_MULTI_SOURCE";
  if (checklistRows > 0) return "CHECKLIST_PRESENT_SINGLE_SOURCE";
  if (sources > 1) return "SET_IDENTITY_MULTI_SOURCE_NO_ROWS";
  return "SET_INDEX_ONLY";
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const masterSets = JSON.parse(
    readFileSync(resolve(MASTER_ROOT, "master-sets.json"), "utf8"),
  );
  const sourceItems = JSON.parse(
    readFileSync(resolve(MASTER_ROOT, "source-items.json"), "utf8"),
  );

  const enriched = masterSets.map((row) => {
    const year = seasonStart(row.season);
    const sport = inferSport(row);
    const deferred = deferredReason(row);
    const inYearRange = year != null && year >= START_YEAR && year <= END_YEAR;
    return {
      ...row,
      year,
      sport,
      universe: sport,
      phase1Status:
        inYearRange && SPORTS.includes(sport) && !deferred
          ? "IN_SCOPE_SPORTS_2000_PLUS"
          : deferred
            ? "DEFERRED_ODDBALL_OR_ONE_OFF"
            : "OUT_OF_SPORTS_PHASE1_SCOPE",
      deferredReason: deferred,
      readiness: readiness(row),
    };
  });

  const sportsSets = enriched.filter(
    (row) => row.phase1Status === "IN_SCOPE_SPORTS_2000_PLUS",
  );
  const deferredSets = enriched.filter(
    (row) => row.phase1Status === "DEFERRED_ODDBALL_OR_ONE_OFF",
  );
  const coverage = [];

  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    for (const sport of SPORTS) {
      const rows = sportsSets.filter(
        (row) => row.year === year && row.sport === sport,
      );
      coverage.push({
        year,
        sport,
        exactSets: rows.length,
        setsWithChecklistRows: rows.filter(
          (row) => Number(row.checklistRowsMaximum || 0) > 0,
        ).length,
        setsWithMultipleSources: rows.filter(
          (row) => Number(row.sourceCount || 0) > 1,
        ).length,
        setIndexOnly: rows.filter((row) => row.readiness === "SET_INDEX_ONLY")
          .length,
        manufacturers: [
          ...new Set(rows.map((row) => row.manufacturer).filter(Boolean)),
        ].sort(),
        coverageStatus:
          rows.length === 0
            ? "NO_SETS_FOUND"
            : rows.some((row) => Number(row.checklistRowsMaximum || 0) > 0)
              ? "CHECKLIST_COVERAGE_PRESENT"
              : "IDENTITIES_ONLY",
      });
    }
  }

  const summaryBySport = SPORTS.map((sport) => {
    const rows = sportsSets.filter((row) => row.sport === sport);
    return {
      sport,
      exactSets: rows.length,
      setsWithChecklistRows: rows.filter(
        (row) => Number(row.checklistRowsMaximum || 0) > 0,
      ).length,
      setsMissingChecklistRows: rows.filter(
        (row) => Number(row.checklistRowsMaximum || 0) < 1,
      ).length,
      setsWithMultipleSources: rows.filter(
        (row) => Number(row.sourceCount || 0) > 1,
      ).length,
      manufacturers: [
        ...new Set(rows.map((row) => row.manufacturer).filter(Boolean)),
      ].sort(),
    };
  });

  const unresolvedSourceItems = sourceItems.filter(
    (row) => row.classificationStatus === "unresolved",
  );
  const totals = {
    phase: "SPORTS_2000_PLUS",
    startYear: START_YEAR,
    endYear: END_YEAR,
    targetSports: SPORTS,
    exactMasterSetsAllYears: masterSets.length,
    inScopeExactSets: sportsSets.length,
    inScopeSetsWithChecklistRows: sportsSets.filter(
      (row) => Number(row.checklistRowsMaximum || 0) > 0,
    ).length,
    inScopeSetsWithMultipleSources: sportsSets.filter(
      (row) => Number(row.sourceCount || 0) > 1,
    ).length,
    inScopeSetIndexOnly: sportsSets.filter(
      (row) => row.readiness === "SET_INDEX_ONLY",
    ).length,
    deferredOddballOrOneOff: deferredSets.length,
    unresolvedSourceItems: unresolvedSourceItems.length,
    emptyYearSportCells: coverage.filter(
      (row) => row.coverageStatus === "NO_SETS_FOUND",
    ).length,
    identityOnlyYearSportCells: coverage.filter(
      (row) => row.coverageStatus === "IDENTITIES_ONLY",
    ).length,
  };

  writeFileSync(
    resolve(OUT, "manifest.json"),
    `${JSON.stringify(
      {
        schema: "tcos.sports2000PlusCoverage.v1",
        generatedAt: new Date().toISOString(),
        scopeRule:
          "Phase 1 covers mainstream sports-card releases from 2000 through the current year. Pokemon and other card universes remain in the same Registry but do not block this sports milestone.",
        completenessRule:
          "A sports set is checklist-ready only when checklistRowsMaximum is greater than zero. Multi-source corroboration is reported separately.",
        totals,
        summaryBySport,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(OUT, "sports-sets.json"),
    `${JSON.stringify(sportsSets, null, 2)}\n`,
  );
  writeFileSync(
    resolve(OUT, "deferred-sports-sets.json"),
    `${JSON.stringify(deferredSets, null, 2)}\n`,
  );
  writeFileSync(
    resolve(OUT, "coverage-by-year-sport.json"),
    `${JSON.stringify(coverage, null, 2)}\n`,
  );
  writeFileSync(
    resolve(OUT, "summary-by-sport.json"),
    `${JSON.stringify(summaryBySport, null, 2)}\n`,
  );

  const setHeaders = [
    "year",
    "sport",
    "season",
    "manufacturer",
    "product",
    "sourceCount",
    "itemCount",
    "checklistRowsMaximum",
    "readiness",
    "sources",
    "exactSetKey",
  ];
  const setCsv = [setHeaders.map(csvCell).join(",")];
  for (const row of sportsSets) {
    setCsv.push(setHeaders.map((header) => csvCell(row[header])).join(","));
  }
  writeFileSync(resolve(OUT, "sports-sets.csv"), `${setCsv.join("\n")}\n`);

  const coverageHeaders = [
    "year",
    "sport",
    "exactSets",
    "setsWithChecklistRows",
    "setsWithMultipleSources",
    "setIndexOnly",
    "coverageStatus",
    "manufacturers",
  ];
  const coverageCsv = [coverageHeaders.map(csvCell).join(",")];
  for (const row of coverage) {
    coverageCsv.push(
      coverageHeaders.map((header) => csvCell(row[header])).join(","),
    );
  }
  writeFileSync(
    resolve(OUT, "coverage-by-year-sport.csv"),
    `${coverageCsv.join("\n")}\n`,
  );

  const summaryHeaders = [
    "sport",
    "exactSets",
    "setsWithChecklistRows",
    "setsMissingChecklistRows",
    "setsWithMultipleSources",
    "manufacturers",
  ];
  const summaryCsv = [summaryHeaders.map(csvCell).join(",")];
  for (const row of summaryBySport) {
    summaryCsv.push(
      summaryHeaders.map((header) => csvCell(row[header])).join(","),
    );
  }
  writeFileSync(
    resolve(OUT, "summary-by-sport.csv"),
    `${summaryCsv.join("\n")}\n`,
  );

  const gaps = coverage.filter(
    (row) => row.coverageStatus !== "CHECKLIST_COVERAGE_PRESENT",
  );
  writeFileSync(
    resolve(OUT, "gap-report.md"),
    [
      "# TCOS Phase 1 — Sports Card Coverage, 2000–Current",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Scope",
      "",
      "Sports cards are the active Phase 1 milestone. Pokemon and every non-sport or TCG universe remain in the same Checklist Registry and will be expanded in later phases.",
      "",
      "## Totals",
      "",
      "```json",
      JSON.stringify(totals, null, 2),
      "```",
      "",
      "## By sport",
      "",
      ...summaryBySport.map(
        (row) =>
          `- ${row.sport}: ${row.exactSets} exact sets; ${row.setsWithChecklistRows} with checklist rows; ${row.setsMissingChecklistRows} needing rows`,
      ),
      "",
      "## Coverage gaps",
      "",
      ...gaps.map(
        (row) =>
          `- ${row.year} — ${row.sport}: ${row.coverageStatus} (${row.exactSets} set identities, ${row.setsWithChecklistRows} with checklist rows)`,
      ),
      "",
      "## Deferred sports material",
      "",
      `Explicit oddball, promotional, regional, food, convention, test, proof, mail-in, postcard, stamp, coin, disc, wrapper, and uncut sports issues deferred: ${deferredSets.length}.`,
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify(totals));
  if (!sportsSets.length) {
    throw new Error("No Phase 1 sports-card sets from 2000-current were found.");
  }
}

main();
