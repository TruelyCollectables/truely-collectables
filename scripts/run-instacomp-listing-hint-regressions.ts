import assert from "node:assert/strict";
import { extractInstaCompUntrustedListingIdentityHint } from "../src/lib/instacomp-listing-identity-hint";

const cases = [
  {
    title: "2025 Panini Select WNBA Kiki Iriafen Pink Camo /175 #123 RC",
    expected: { year: "2025", brand: "Panini", setName: "Select", cardNumber: "123" },
  },
  {
    title: "2025 Bowman Chrome Mojo George Lombard Jr BCP-67 Yankees",
    expected: { year: "2025", brand: "Topps", setName: "Bowman Chrome", cardNumber: "BCP-67" },
  },
  {
    title: "2025 Bowman Chrome Mojo Jesus Made BCP-20 Brewers",
    expected: { year: "2025", brand: "Topps", setName: "Bowman Chrome", cardNumber: "BCP-20" },
  },
  {
    title: "2025 Panini Mosaic WNBA Caitlin Clark Disco #11",
    expected: { year: "2025", brand: "Panini", setName: "Mosaic", cardNumber: "11" },
  },
  {
    title: "2024-25 Upper Deck Stature Matvei Michkov Rookie #101",
    expected: { year: "2024-25", brand: "Upper Deck", setName: "Stature", cardNumber: "101" },
  },
  {
    title: "2024-25 Upper Deck SP Game Used Matvei Michkov Rookie #82",
    expected: { year: "2024-25", brand: "Upper Deck", setName: "SP Game Used", cardNumber: "82" },
  },
  {
    title: "2024-25 Upper Deck Extended Series Young Guns #701",
    expected: { year: "2024-25", brand: "Upper Deck", setName: "Upper Deck Extended Series", cardNumber: "701" },
  },
  {
    title: "2025 Topps Chrome Update Baseball Rookie #USC12",
    expected: { year: "2025", brand: "Topps", setName: "Topps Chrome Update", cardNumber: "USC12" },
  },
];

for (const test of cases) {
  const actual = extractInstaCompUntrustedListingIdentityHint(test.title);
  assert.equal(actual.year, test.expected.year, `${test.title}: year`);
  assert.equal(actual.brand, test.expected.brand, `${test.title}: brand`);
  assert.equal(actual.setName, test.expected.setName, `${test.title}: set`);
  assert.equal(actual.cardNumber, test.expected.cardNumber, `${test.title}: card number`);
}

const serialOnly = extractInstaCompUntrustedListingIdentityHint(
  "2025 Panini Select WNBA Kiki Iriafen Pink Camo 23/175",
);
assert.equal(
  serialOnly.cardNumber,
  null,
  "Serial numbering must never be promoted to a checklist card number hint.",
);

const unknown = extractInstaCompUntrustedListingIdentityHint(
  "2025 Random Brand Mystery Card 12/25",
);
assert.equal(unknown.setName, null, "Unknown product names must remain unresolved.");
assert.equal(unknown.cardNumber, null, "Unlabeled serial-style numbers must remain unresolved.");

console.log(`InstaComp listing-hint regressions passed (${cases.length + 2}/${cases.length + 2}).`);
