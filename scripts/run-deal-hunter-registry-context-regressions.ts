import assert from "node:assert/strict";
import { buildInstaCompRegistryLockProbe } from "../src/lib/instacomp-registry-lock-request";
import { dealHunterListingRegistryConflict } from "../src/lib/deal-hunter-listing-registry-guard";

const kikiProbe = buildInstaCompRegistryLockProbe({
  year: "2025",
  brand: "Panini",
  setName: "Base Red",
  cardNumber: "94",
  registryVisibleText:
    "2025 PANINI - WNBA DONRUSS BASKETBALL KIKI IRIAFEN WASHINGTON MYSTICS No. 94",
});
assert.equal(kikiProbe.setName, "Panini Donruss WNBA");
assert.equal(kikiProbe.sport, "Basketball");
assert.equal(kikiProbe.league, "WNBA");

const selectProbe = buildInstaCompRegistryLockProbe({
  year: "2025",
  brand: "Panini",
  setName: "Base Set - Concourse",
  cardNumber: "60",
  registryVisibleText:
    "2025 PANINI - WNBA SELECT BASKETBALL DOMINIQUE MALONGA No. 60 CONCOURSE",
});
assert.equal(selectProbe.setName, "Panini Select WNBA");
assert.equal(selectProbe.sport, "Basketball");
assert.equal(selectProbe.league, "WNBA");

assert.match(
  dealHunterListingRegistryConflict(
    {
      watchedPerson: "Kiki Iriafen",
      title: "2025 Donruss WNBA Kiki Iriafen Rookie Card (RC) #94 - Washington Mystics",
    },
    { ai: { player: "Jack Leiter", cardNumber: "94", sport: "baseball", parallel: "Base" } },
  ) || "",
  /watched player/i,
);

assert.match(
  dealHunterListingRegistryConflict(
    {
      watchedPerson: "Sonia Citron",
      title: "Sonia Citron Rated Rookie RC 2025 Donruss WNBA Basketball Card #87 Mystics",
    },
    { ai: { player: "Alex Rodriguez", cardNumber: "87", sport: "baseball", parallel: "Base" } },
  ) || "",
  /watched player/i,
);

assert.match(
  dealHunterListingRegistryConflict(
    {
      watchedPerson: "Dominique Malonga",
      title: "2025 Panini Prizm WNBA Dominique Malonga Rookie Card #144",
    },
    {
      ai: {
        player: "Dominique Malonga",
        cardNumber: "60",
        sport: "Basketball",
        parallel: "Silver Prizms",
      },
    },
  ) || "",
  /card number/i,
);

assert.match(
  dealHunterListingRegistryConflict(
    {
      watchedPerson: "Dominique Malonga",
      title: "Dominique Malonga 2025 Panini Select WNBA Pink Flash Prizm Rookie Card-#60 Storm",
    },
    {
      ai: {
        player: "Dominique Malonga",
        cardNumber: "60",
        sport: "Basketball",
        parallel: "Silver Prizms",
      },
    },
  ) || "",
  /parallel/i,
);

assert.equal(
  dealHunterListingRegistryConflict(
    {
      watchedPerson: "Kiki Iriafen",
      title: "2025 Panini WNBA Prizm Basketball Kiki Iriafen Silver Prizm Rookie Card #72",
    },
    {
      ai: {
        player: "Kiki Iriafen",
        cardNumber: "72",
        sport: "Basketball",
        league: "WNBA",
        parallel: "Prizms Silver",
      },
    },
  ),
  null,
);

assert.match(
  dealHunterListingRegistryConflict(
    {
      watchedPerson: "Kiki Iriafen",
      title: "2025 Donruss WNBA Kiki Iriafen Rookie Card #94",
    },
    {
      ai: {
        player: "Kiki Iriafen",
        cardNumber: "94",
        sport: "Baseball",
        league: "MLB",
        parallel: "Base",
      },
    },
  ) || "",
  /WNBA listing conflicts/i,
);

console.log(
  "PASS Deal Hunter Registry context guard blocks cross-player, cross-card, cross-league, and explicit parallel contradictions while preserving the valid Kiki #72 Silver lock",
);
