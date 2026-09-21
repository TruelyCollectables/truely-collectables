import assert from "node:assert/strict";
import {
  buildInstaCompCanonicalTitle as title,
  buildInstaCompRegistryExactTitle as exactTitle,
} from "../src/lib/instacomp-canonical-title";

const selectBase = title({
  year: "2025", manufacturer: "Panini", brand: "Select", product: "Select WNBA",
  setName: "Base Set - Concourse", subset: "Concourse", cardNumber: "83",
  player: "Sonia Citron", team: "Washington Mystics", parallel: "Base", isRookie: true,
});
assert.equal(selectBase, "2025 Select Concourse #83 Sonia Citron RC");

const prizmBase = title({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Base", cardNumber: "122", player: "Sonia Citron",
  team: "Washington Mystics", parallel: "Base", isRookie: true,
});
assert.equal(prizmBase, "2025 Panini Prizm #122 Sonia Citron RC");

const prizmSilver = title({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Base", cardNumber: "122", player: "Sonia Citron",
  parallel: "Silver", isRookie: true,
});
assert.equal(prizmSilver, "2025 Panini Prizm #122 Sonia Citron RC Silver Prizm");

const prizmVelocity = title({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Base", cardNumber: "122", player: "Sonia Citron",
  parallel: "Prizms Blue Velocity", isRookie: true,
});
assert.equal(prizmVelocity, "2025 Panini Prizm #122 Sonia Citron RC Blue Velocity Prizm");

const pollutedPrizmBase = title({
  year: "2025", manufacturer: "Prizm", brand: "Prizm", product: "Prizm WNBA",
  setName: "Base", subset: "Sonia Citron", cardNumber: "122", player: "Sonia Citron",
  parallel: "Base", isRookie: true,
});
assert.equal(pollutedPrizmBase, "2025 Panini Prizm #122 Sonia Citron RC");

const prizmInsertGreen = title({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Kaleidoscopic", cardNumber: "14", player: "Paige Bueckers",
  parallel: "Green", isRookie: true,
});
assert.equal(prizmInsertGreen, "2025 Panini Prizm Kaleidoscopic #14 Paige Bueckers RC Green Prizm");

const selectParallel = title({
  year: "2025", manufacturer: "Panini", brand: "Select", product: "Select WNBA",
  setName: "Base", subset: "Concourse", cardNumber: "83", player: "Sonia Citron",
  parallel: "Set - Concourse - Pink Flash", isRookie: true,
});
assert.equal(selectParallel, "2025 Select Concourse #83 Sonia Citron RC Pink Flash");
const selectFuture = title({
  year: "2025", manufacturer: "Panini", brand: "Select", product: "Select WNBA",
  setName: "Select Future", cardNumber: "18", player: "Lucy Olsen", parallel: "Base", isRookie: true,
});
assert.equal(selectFuture, "2025 Select Future #18 Lucy Olsen RC");
const season = title({
  year: "2023", manufacturer: "Upper Deck", product: "Upper Deck Extended Series",
  setName: "Base Set", cardNumber: "597", player: "Vladimir Tarasenko", parallel: "Outburst",
}, { rawTitle: "2023-24 Upper Deck Extended Series #597 Vladimir Tarasenko Outburst Silver" });
assert.equal(season, "2023-24 Upper Deck Extended Series #597 Vladimir Tarasenko Outburst Silver");

const mojo = title({
  year: "2025", manufacturer: "Topps", brand: "Bowman Chrome", product: "Bowman Draft Mega Box",
  setName: "Base Mega Box Chrome Prospects", subset: "Base Mega Box Chrome Prospects",
  cardNumber: "BDC-64", player: "Brandon Compton", parallel: "Base",
}, { rawTitle: "2025 Bowman Draft Chrome Mojo Refractor #BDC-64 Brandon Compton" });
assert.equal(mojo, "2025 Bowman Draft Chrome Mojo Refractor #BDC-64 Brandon Compton");

const fernandoMendoza = title({
  year: "2026", manufacturer: "Topps", brand: "Topps", product: "Flagship Football",
  setName: "ROOKIES", subset: "Fernando Mendoza", cardNumber: "301", player: "Fernando Mendoza",
  team: "Las Vegas Raiders", parallel: "Base",
});
assert.equal(
  fernandoMendoza,
  "2026 Topps Flagship Football ROOKIES #301 Fernando Mendoza",
);

const fernandoRegistryExact = exactTitle({
  year: "2026",
  manufacturer: "Topps",
  brand: "Topps",
  product: "Flagship Football",
  setName: "ROOKIES",
  cardNumber: "301",
  player: "Fernando Mendoza",
  team: "Las Vegas Raiders",
  parallel: "Base",
});
assert.equal(
  fernandoRegistryExact,
  "2026 Topps Flagship Football ROOKIES #301 Fernando Mendoza Las Vegas Raiders",
);

const fernandoLockedFieldsShape = exactTitle({
  year: "2026",
  manufacturer: "Topps",
  brand: "Topps",
  product: "Flagship Football",
  setName: "Flagship Football",
  subset: "ROOKIES",
  cardNumber: "301",
  player: "Fernando Mendoza",
  team: "Las Vegas Raiders",
  parallel: "Base",
});
assert.equal(
  fernandoLockedFieldsShape,
  fernandoRegistryExact,
);

const prizmRegistryBase = exactTitle({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Prizm WNBA", subset: "Base", cardNumber: "146", player: "Aneesah Morrow",
  team: "Connecticut Sun", parallel: "Base",
});
assert.equal(
  prizmRegistryBase,
  "2025 Panini Prizm WNBA #146 Aneesah Morrow Connecticut Sun",
);

const prizmRegistryIce = exactTitle({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Prizm WNBA", subset: "Base", cardNumber: "150", player: "Saniya Rivers",
  team: "Connecticut Sun", parallel: "Ice",
});
assert.equal(
  prizmRegistryIce,
  "2025 Panini Prizm WNBA #150 Saniya Rivers Connecticut Sun Ice",
);

const prizmRegistrySilver = exactTitle({
  year: "2025", manufacturer: "Panini", brand: "Prizm", product: "Prizm WNBA",
  setName: "Prizm WNBA", subset: "Base", cardNumber: "140", player: "Georgia Amoore",
  team: "Washington Mystics", parallel: "Silver",
});
assert.equal(
  prizmRegistrySilver,
  "2025 Panini Prizm WNBA #140 Georgia Amoore Washington Mystics Silver",
);
assert.notEqual(prizmRegistryIce, prizmRegistrySilver);
assert.doesNotMatch(prizmRegistryBase, /\bBase\b/i);

const learnedRc = title({
  year: "2025", manufacturer: "Panini", product: "Prizm WNBA", setName: "Base",
  cardNumber: "122", player: "Sonia Citron", parallel: "Base",
}, { forceRookie: true });
assert.equal(learnedRc, "2025 Panini Prizm #122 Sonia Citron RC");

for (const value of [selectBase, prizmBase, prizmSilver, prizmVelocity, pollutedPrizmBase, prizmInsertGreen, selectParallel, selectFuture, season, mojo, fernandoMendoza, learnedRc]) {
  assert.doesNotMatch(value, /\bBase Set\b/i);
  assert.doesNotMatch(value, /\sBase$/i);
  assert.doesNotMatch(value, /\((?:Washington Mystics|Dallas Wings|Colorado Avalanche)\)/i);
}
console.log("PASS InstaComp canonical title regressions");
