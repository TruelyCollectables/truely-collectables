import assert from "node:assert/strict";
import {
  deriveCardIdentity,
  inferPlayerFromCardTitle,
} from "../src/lib/card-identity";

const productionRegressions = [
  {
    title:
      "2011 Bowman Sterling Mike Stanton Hanley Ramirez Dual Relics Refractors /99",
    currentPlayer: "Sterling Mike / Stanton Hanley",
    expected: "Mike Stanton / Hanley Ramirez",
  },
  {
    title:
      "2022-23 Black Diamond Tkachuk Stutzle MEM Diamond Mine Dual Relics #DMDR-TS",
    currentPlayer: "Tkachuk Stutzle / MEM Diamond",
    expected: "Brady Tkachuk / Tim Stutzle",
  },
  {
    title:
      "2023-24 OPC Platinum Liquid Metal Leo Carlsson #293 Marquee RC /399 Ducks",
    currentPlayer: null,
    expected: "Leo Carlsson",
  },
  {
    title:
      "2023-24 O-PEE-CHEE PLATINUM RED PRISM AUTO LEO CARLSSON MARQUEE RC AUTO /199",
    currentPlayer: null,
    expected: "Leo Carlsson",
  },
] as const;

for (const regression of productionRegressions) {
  assert.equal(
    inferPlayerFromCardTitle(regression.title),
    regression.expected,
    `${regression.title} title parser failed`,
  );
  assert.equal(
    deriveCardIdentity({
      title: regression.title,
      aspectPlayer: regression.currentPlayer,
    }).player,
    regression.expected,
    `${regression.title} did not replace the polluted production value`,
  );
}

console.log(
  JSON.stringify({
    success: true,
    productionRegressionsChecked: productionRegressions.length,
  }),
);
