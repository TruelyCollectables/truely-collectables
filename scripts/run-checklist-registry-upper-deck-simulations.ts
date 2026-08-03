import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  parseUpperDeckOfficialHtmlChecklist,
  upperDeckOfficialHtmlChecklistAdapter,
} from "../src/lib/checklist-registry/upper-deck-official-html";
import type {
  ChecklistImportPlan,
  ChecklistSourceArtifact,
} from "../src/lib/checklist-registry/source-adapter";

const seriesOneHtml = readFileSync(
  resolve(
    process.cwd(),
    "scripts/fixtures/checklist-registry/2024-25-upper-deck-series-1.sample.html",
  ),
  "utf8",
);
const allureHtml = readFileSync(
  resolve(
    process.cwd(),
    "scripts/fixtures/checklist-registry/2025-26-upper-deck-allure.sample.html",
  ),
  "utf8",
);

const seriesOneArtifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://upperdeck.com/checklist/2024-25-ud-series-1-hockey-checklist/",
  originalFilename: "2024-25-ud-series-1-hockey-checklist.html",
  mimeType: "text/html",
  content: seriesOneHtml,
  retrievedAt: "2026-08-03T01:35:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
};

const allureArtifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://upperdeck.com/checklist/2025-2026-allure-hockey-checklist/",
  originalFilename: "2025-2026-allure-hockey-checklist.html",
  mimeType: "text/html",
  content: allureHtml,
  retrievedAt: "2026-08-03T01:35:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
};

type Scenario = {
  key: string;
  passed: boolean;
  detail: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
function scenario(
  key: string,
  detail: string,
  passed: boolean,
  evidence: Record<string, unknown>,
) {
  scenarios.push({ key, detail, passed, evidence });
}

function findIdentity(
  plan: ChecklistImportPlan,
  params: {
    setName: string;
    cardNumber: string;
    parallel: string;
    serialRun?: string;
    autographStatus?: string;
  },
) {
  return plan.identities.find((entry) => {
    const value = entry.fingerprint.normalized;
    return (
      value.setName === params.setName.toLowerCase() &&
      value.cardNumber === params.cardNumber.toLowerCase() &&
      value.parallel === params.parallel.toLowerCase() &&
      (params.serialRun === undefined || value.serialRun === params.serialRun) &&
      (params.autographStatus === undefined ||
        value.autographStatus === params.autographStatus)
    );
  });
}

function allUnique(plan: ChecklistImportPlan) {
  return (
    new Set(
      plan.identities.map((entry) => entry.fingerprint.fingerprintSha256),
    ).size === plan.identities.length
  );
}

const seriesOne = parseUpperDeckOfficialHtmlChecklist(seriesOneArtifact);
const allure = parseUpperDeckOfficialHtmlChecklist(allureArtifact);

scenario(
  "official_upper_deck_html_is_selected",
  "The adapter accepts official Upper Deck checklist HTML and rejects unrelated HTML.",
  upperDeckOfficialHtmlChecklistAdapter.supports(seriesOneArtifact) &&
    !upperDeckOfficialHtmlChecklistAdapter.supports({
      ...seriesOneArtifact,
      sourceUrl: "https://example.test/checklist.html",
    }),
  {
    adapter: {
      id: upperDeckOfficialHtmlChecklistAdapter.id,
      version: upperDeckOfficialHtmlChecklistAdapter.version,
    },
  },
);

scenario(
  "series_one_fixture_validates",
  "The Series 1 source-shaped fixture produces a passed plan with only the expected test-batch warning.",
  seriesOne.validation.status === "passed" &&
    seriesOne.validation.issues.every((entry) => entry.severity === "warning") &&
    seriesOne.validation.issues.some((entry) => entry.code === "test_batch_only"),
  {
    release: seriesOne.release,
    counts: seriesOne.validation.counts,
    issues: seriesOne.validation.issues,
  },
);

scenario(
  "series_one_release_context_is_hockey",
  "The official source path supplies Hockey/NHL context when the page heading omits Hockey.",
  seriesOne.release.product === "Upper Deck Series 1" &&
    seriesOne.release.season === "2024-25" &&
    seriesOne.release.sport === "Hockey" &&
    seriesOne.release.league === "NHL" &&
    seriesOne.identities.every(
      (entry) =>
        entry.fingerprint.normalized.sport === "hockey" &&
        entry.fingerprint.normalized.league === "nhl",
    ),
  { release: seriesOne.release },
);

scenario(
  "series_one_counts_match_fixture",
  "Eight source rows collapse to two shared card facts while preserving eight physical printings.",
  seriesOne.validation.counts.sets === 2 &&
    seriesOne.validation.counts.cards === 2 &&
    seriesOne.validation.counts.parallels === 6 &&
    seriesOne.validation.counts.identities === 8,
  seriesOne.validation.counts,
);

const laneYoungGunsBase = findIdentity(seriesOne, {
  setName: "Young Guns",
  cardNumber: "229",
  parallel: "base",
});
const laneClearCut = findIdentity(seriesOne, {
  setName: "Young Guns",
  cardNumber: "229",
  parallel: "Clear Cut",
});
const laneDeluxe250 = findIdentity(seriesOne, {
  setName: "Young Guns",
  cardNumber: "229",
  parallel: "Deluxe",
  serialRun: "/250",
});
const laneOutburstRed25 = findIdentity(seriesOne, {
  setName: "Young Guns",
  cardNumber: "229",
  parallel: "Outburst Red",
  serialRun: "/25",
});
const laneOutburstGoldOne = findIdentity(seriesOne, {
  setName: "Young Guns",
  cardNumber: "229",
  parallel: "Outburst Gold",
  serialRun: "/1",
});

scenario(
  "lane_hutson_young_guns_printings_never_merge",
  "Young Guns Base, Clear Cut, Deluxe /250, Outburst Red /25, and Outburst Gold 1/1 remain distinct.",
  Boolean(
    laneYoungGunsBase &&
      laneClearCut &&
      laneDeluxe250 &&
      laneOutburstRed25 &&
      laneOutburstGoldOne,
  ) &&
    new Set(
      [
        laneYoungGunsBase,
        laneClearCut,
        laneDeluxe250,
        laneOutburstRed25,
        laneOutburstGoldOne,
      ].map((entry) => entry?.fingerprint.fingerprintSha256),
    ).size === 5,
  {
    base: laneYoungGunsBase?.fingerprint,
    clearCut: laneClearCut?.fingerprint,
    deluxe250: laneDeluxe250?.fingerprint,
    outburstRed25: laneOutburstRed25?.fingerprint,
    outburstGoldOne: laneOutburstGoldOne?.fingerprint,
  },
);

const laneCanvas = findIdentity(seriesOne, {
  setName: "UD Canvas - Young Guns",
  cardNumber: "C-111",
  parallel: "base",
});
const laneCanvasBlackWhite = findIdentity(seriesOne, {
  setName: "UD Canvas - Young Guns",
  cardNumber: "C-111",
  parallel: "Black and White",
});
const laneCanvasPlate = findIdentity(seriesOne, {
  setName: "UD Canvas - Young Guns",
  cardNumber: "C-111",
  parallel: "Printing Plates",
  serialRun: "/4",
});

scenario(
  "canvas_young_guns_and_printing_plates_stay_distinct",
  "Canvas Young Guns, Black and White, and Printing Plates /4 remain separate from standard Young Guns.",
  Boolean(laneCanvas && laneCanvasBlackWhite && laneCanvasPlate) &&
    new Set(
      [laneYoungGunsBase, laneCanvas, laneCanvasBlackWhite, laneCanvasPlate].map(
        (entry) => entry?.fingerprint.fingerprintSha256,
      ),
    ).size === 4,
  {
    standardYoungGuns: laneYoungGunsBase?.fingerprint,
    canvas: laneCanvas?.fingerprint,
    blackAndWhite: laneCanvasBlackWhite?.fingerprint,
    printingPlate: laneCanvasPlate?.fingerprint,
  },
);

scenario(
  "series_one_source_evidence_is_preserved",
  "Official labels, technology, odds, configurations, and points remain in private row evidence.",
  seriesOne.cards.some((card) => {
    if (card.cardNumber !== "229") return false;
    const notes = JSON.parse(card.sourceNotes || "{}") as {
      schema?: string;
      rows?: Array<{
        officialSetName?: string;
        memorabiliaOrTechnology?: string | null;
        statedOdds?: string | null;
        configurations?: string[];
      }>;
    };
    return (
      notes.schema === "tcos.upperDeck.rowEvidence.v1" &&
      notes.rows?.some(
        (row) =>
          row.officialSetName === "Clear Cut Parallel - Young Guns" &&
          row.memorabiliaOrTechnology === "Acetate" &&
          row.statedOdds === "1:144 Hobby" &&
          row.configurations?.includes("Hobby"),
      )
    );
  }),
  { cards: seriesOne.cards },
);

scenario(
  "allure_fixture_validates",
  "The Allure fixture validates while preserving the expected set-type and test-batch warnings.",
  allure.validation.status === "passed" &&
    allure.validation.issues.every((entry) => entry.severity === "warning") &&
    allure.validation.counts.sets === 2 &&
    allure.validation.counts.cards === 3 &&
    allure.validation.counts.parallels === 5 &&
    allure.validation.counts.identities === 7,
  {
    release: allure.release,
    counts: allure.validation.counts,
    issues: allure.validation.issues,
  },
);

const demidovBase = findIdentity(allure, {
  setName: "Rookies",
  cardNumber: "110",
  parallel: "base",
});
const demidovBlackRainbow = findIdentity(allure, {
  setName: "Rookies",
  cardNumber: "110",
  parallel: "Black Rainbow",
});
const demidovOrangeSlice = findIdentity(allure, {
  setName: "Rookies",
  cardNumber: "110",
  parallel: "Orange Slice",
});
const demidovGoldGlitterBomb = findIdentity(allure, {
  setName: "Rookies",
  cardNumber: "110",
  parallel: "Gold Glitter Bomb",
  serialRun: "/199",
});

scenario(
  "demidov_allure_printings_never_merge",
  "Allure Base, Black Rainbow, Orange Slice, and Gold Glitter Bomb /199 remain distinct.",
  Boolean(
    demidovBase &&
      demidovBlackRainbow &&
      demidovOrangeSlice &&
      demidovGoldGlitterBomb,
  ) &&
    new Set(
      [
        demidovBase,
        demidovBlackRainbow,
        demidovOrangeSlice,
        demidovGoldGlitterBomb,
      ].map((entry) => entry?.fingerprint.fingerprintSha256),
    ).size === 4,
  {
    base: demidovBase?.fingerprint,
    blackRainbow: demidovBlackRainbow?.fingerprint,
    orangeSlice: demidovOrangeSlice?.fingerprint,
    goldGlitterBomb199: demidovGoldGlitterBomb?.fingerprint,
  },
);

const demidovHittingGrooveBase = findIdentity(allure, {
  setName: "Hitting Thier Groove",
  cardNumber: "HTG-2",
  parallel: "base",
});
const demidovGoldenTreasures = findIdentity(allure, {
  setName: "Hitting Thier Groove",
  cardNumber: "HTG-2",
  parallel: "Golden Treasures",
  serialRun: "/1",
});
const demidovAuto = findIdentity(allure, {
  setName: "Hitting Thier Groove",
  cardNumber: "HTG-2",
  parallel: "Auto",
  autographStatus: "autograph",
});

scenario(
  "allure_insert_parallel_auto_and_one_of_one_stay_distinct",
  "The base insert, Golden Treasures 1/1, and SP autograph remain separate.",
  Boolean(
    demidovHittingGrooveBase && demidovGoldenTreasures && demidovAuto,
  ) &&
    demidovAuto?.fingerprint.normalized.variation === "sp" &&
    new Set(
      [
        demidovHittingGrooveBase,
        demidovGoldenTreasures,
        demidovAuto,
      ].map((entry) => entry?.fingerprint.fingerprintSha256),
    ).size === 3,
  {
    base: demidovHittingGrooveBase?.fingerprint,
    goldenTreasures: demidovGoldenTreasures?.fingerprint,
    autograph: demidovAuto?.fingerprint,
  },
);

scenario(
  "private_archive_receipts_are_deterministic",
  "Both HTML sources receive private content-addressed archive receipts.",
  [seriesOne, allure].every(
    (plan) =>
      plan.source.privateArchiveRequired &&
      plan.source.normalizedFactsInternalOnly &&
      plan.source.storage.isPublic === false &&
      plan.source.storage.mimeType === "text/html" &&
      plan.source.storage.objectPath.includes(plan.source.storage.sha256),
  ),
  {
    seriesOne: seriesOne.source.storage,
    allure: allure.source.storage,
  },
);

const wrongDomain = parseUpperDeckOfficialHtmlChecklist({
  ...seriesOneArtifact,
  sourceUrl: "https://example.test/upper-deck-series-1.html",
});
scenario(
  "claimed_official_wrong_domain_fails_closed",
  "A file claiming official-manufacturer authority fails from a non-Upper-Deck domain.",
  wrongDomain.validation.status === "validation_required" &&
    wrongDomain.validation.issues.some(
      (entry) =>
        entry.code === "official_source_domain_mismatch" &&
        entry.severity === "error",
    ),
  { issues: wrongDomain.validation.issues },
);

const exactSeriesOneBaseRow =
  '<tr><td>Base Set - Young Guns</td><td>229</td><td>Lane Hutson</td><td>Montreal</td><td>Canadiens</td><td>Rookie</td><td></td><td></td><td></td><td>1:2 h, 1:2 e, 1:2.25 b, 1:2 starter, 1:2 tin, 1:2 hanger, 1:50 dollar</td><td>20</td></tr>';
const duplicatePlan = parseUpperDeckOfficialHtmlChecklist({
  ...seriesOneArtifact,
  content: seriesOneHtml.replace(
    "</tbody>",
    `${exactSeriesOneBaseRow}</tbody>`,
  ),
});
scenario(
  "duplicate_printing_rows_enter_validation",
  "An exact duplicate physical-printing row is rejected rather than silently duplicated.",
  duplicatePlan.validation.status === "validation_required" &&
    duplicatePlan.validation.issues.some(
      (entry) => entry.code === "duplicate_identity" && entry.severity === "error",
    ),
  { issues: duplicatePlan.validation.issues },
);

const malformedSerialPlan = parseUpperDeckOfficialHtmlChecklist({
  ...seriesOneArtifact,
  content: seriesOneHtml.replace(
    "<td>250</td><td>Random Inserts in Hobby and e-Pack</td>",
    "<td>unknown</td><td>Random Inserts in Hobby and e-Pack</td>",
  ),
});
scenario(
  "unparseable_serial_runs_fail_closed",
  "Unknown serial text cannot become a fabricated print run.",
  malformedSerialPlan.validation.status === "validation_required" &&
    malformedSerialPlan.validation.issues.some(
      (entry) => entry.code === "serial_run_unparsed" && entry.severity === "error",
    ),
  { issues: malformedSerialPlan.validation.issues },
);

scenario(
  "all_identity_fingerprints_are_unique",
  "Every generated physical-printing fingerprint is unique within each proof release.",
  allUnique(seriesOne) && allUnique(allure),
  {
    seriesOneIdentities: seriesOne.identities.length,
    allureIdentities: allure.identities.length,
  },
);

const failed = scenarios.filter((entry) => !entry.passed);
const output = {
  schema: "tcos.checklist.upperDeckSimulation.v1",
  status: failed.length ? "failed" : "passed",
  scenarioCount: scenarios.length,
  passedCount: scenarios.length - failed.length,
  failedCount: failed.length,
  plans: {
    seriesOne: {
      release: seriesOne.release,
      counts: seriesOne.validation.counts,
    },
    allure: {
      release: allure.release,
      counts: allure.validation.counts,
    },
  },
  scenarios,
};

console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exitCode = 1;
