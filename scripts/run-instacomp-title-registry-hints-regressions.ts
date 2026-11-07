import assert from "node:assert/strict";
import {
  titleRegistryDimensionHints,
  titleSerialNumberHint,
} from "../src/lib/instacomp-title-registry-hints";

const fernando = titleRegistryDimensionHints({
  title: "2026 Topps Flagship Football ROOKIES #301 Fernando Mendoza Base",
  manufacturer: "Topps",
  cardNumber: "301",
});
assert(
  fernando.some(
    (hint) =>
      hint.brand === "Flagship Football" && hint.setName === "ROOKIES",
  ),
  "Fernando title must expose Flagship Football + ROOKIES as a Registry narrowing attempt.",
);

const saniya = titleRegistryDimensionHints({
  title: "2025 Panini Prizm WNBA Saniya Rivers #150 Ice",
  manufacturer: "Panini",
  cardNumber: "150",
});
assert(
  saniya.some(
    (hint) => hint.brand === "Prizm WNBA" && hint.setName === null,
  ),
  "Saniya title must retry the Prizm WNBA product family without treating her name as a set.",
);

const honorRoll = titleRegistryDimensionHints({
  title: "2023 Upper Deck Series 2 Honor Roll #HR46 Joona Koppanen",
  manufacturer: "Upper Deck",
  cardNumber: "HR46",
});
assert(
  honorRoll.some(
    (hint) => hint.brand === "Series 2" && hint.setName === "Honor Roll",
  ),
  "Upper Deck title must split Series 2 + Honor Roll.",
);

assert.equal(
  titleSerialNumberHint(
    "2023 SkyBox Metal Universe #86 Charlie McAvoy Purple Spectrum FX /199",
  ),
  "/199",
);
assert.equal(titleSerialNumberHint("One of One 1/1"), "1/1");

console.log("PASS InstaComp title → Registry dimension hint regressions");
