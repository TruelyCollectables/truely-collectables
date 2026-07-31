import assert from "node:assert/strict";
import {
  deriveCardIdentity,
  inferPlayerFromCardTitle,
  isLikelyPlayerName,
} from "../src/lib/card-identity";

const cases = [
  {
    title: "2024 Panini Prizm WNBA #1 Caitlin Clark Fractal",
    currentPlayer: "Panini Wnba",
    expected: "Caitlin Clark",
  },
  {
    title: "2021-22 Upper Deck Artifacts Hockey #123 Mark Stone",
    currentPlayer: "Artifacts Hockey",
    expected: "Mark Stone",
  },
  {
    title: "1997-98 Fleer #100 Shaquille O'Neal Traditions Crystal",
    currentPlayer: null,
    expected: "Shaquille O'Neal",
  },
  {
    title: "#343 Gary Sheffield RC Collector's Edition",
    currentPlayer: null,
    expected: "Gary Sheffield",
  },
  {
    title: "2023 Topps Chrome #200 Corbin Carroll RC",
    currentPlayer: null,
    expected: "Corbin Carroll",
  },
  {
    title: "2021-22 Upper Deck #201 Cole Caufield Young Guns",
    currentPlayer: null,
    expected: "Cole Caufield",
  },
  {
    title: "2024 Panini Prizm WNBA Caitlin Clark Fractal #1",
    currentPlayer: "Panini Wnba",
    expected: "Caitlin Clark",
  },
  {
    title: "2023 Bowman #1 Elly De La Cruz RC",
    currentPlayer: null,
    expected: "Elly De La Cruz",
  },
  {
    title: "2022 Donruss #100 Ken Griffey Jr. Holo",
    currentPlayer: null,
    expected: "Ken Griffey Jr.",
  },
  {
    title: "2020 Panini #1 Amon-Ra St. Brown RC",
    currentPlayer: null,
    expected: "Amon-Ra St. Brown",
  },
  {
    title: "2024 Topps #1 Juan Pablo Montoya",
    currentPlayer: null,
    expected: "Juan Pablo Montoya",
  },
  {
    title: "2024 Topps #1 Trae Young Silver",
    currentPlayer: null,
    expected: "Trae Young",
  },
  {
    title: "2024 Panini Prizm #1 Derrick White Silver",
    currentPlayer: null,
    expected: "Derrick White",
  },
  {
    title: "2024 Topps #1 A.J. Green Silver",
    currentPlayer: null,
    expected: "A.J. Green",
  },
  {
    title: "2024 Panini Prizm WWE #6 \"Dirty\" Dominik Mysterio Emergent Mojo Prizms #/25",
    currentPlayer: null,
    expected: "Dominik Mysterio",
  },
  {
    title: "2017-18 Ultimate Collection Alex Tuch Ultimate Introductions RC Onyx /25",
    currentPlayer: null,
    expected: "Alex Tuch",
  },
  {
    title: "2021 Topps Clearly Authentic Gary Sheffield 1986 Autographs Red /50",
    currentPlayer: null,
    expected: "Gary Sheffield",
  },
  {
    title: "2013-14 Totally Certified Nick Van Exel Totally Gold Signatures /3 PSA 9 POP 1",
    currentPlayer: null,
    expected: "Nick Van Exel",
  },
  {
    title: "2014 Topps Vault First Edition Blank Back Donovan Solano 1/1 BGS AUTHENTIC 1st",
    currentPlayer: null,
    expected: "Donovan Solano",
  },
  {
    title: "2023 Panini One RC Tank Bigsby RPA Premium Patch On Card Auto Gold /10 Jaguars",
    currentPlayer: null,
    expected: "Tank Bigsby",
  },
  {
    title: "2024 WWE Prizm Booker T Gold Legendary Signatures Disco Variation /10 Booker-T",
    currentPlayer: null,
    expected: "Booker T",
  },
  {
    title: "2019-20 Panini Noir #RN-NVE Nick Van Exel Reigning Nights Signatures /99",
    currentPlayer: "Reigning Nights",
    expected: "Nick Van Exel",
  },
  {
    title: "2012 Onyx Platinum Prospects #PP50 Christian Yelich Limited Edition Silver #/100",
    currentPlayer: "Christian Yelich Limited",
    expected: "Christian Yelich",
  },
  {
    title: "2024 POP CENTURY RETRO TV AUTO ED MARINARO 1/1 AUTOGRAPH \"HILL STREET BLUES\"",
    currentPlayer: "Century Retro Tv",
    expected: "Ed Marinaro",
  },
  {
    title: "2020 Bowman Draft Chrome 1ST RC Max Meyer AUTO IMAGE VARIATION REFRACTOR /99 SP",
    currentPlayer: "Image Variation",
    expected: "Max Meyer",
  },
  {
    title: "2017 Bowman Chrome Prospect Autographs Sandy Alcantara Blue Ref /150 SGC 8/10",
    currentPlayer: "Blue Ref",
    expected: "Sandy Alcantara",
  },
] as const;

for (const testCase of cases) {
  const identity = deriveCardIdentity({
    title: testCase.title,
    aspectPlayer: testCase.currentPlayer,
  });
  assert.equal(
    identity.player,
    testCase.expected,
    `${testCase.title} resolved to ${identity.player ?? "null"}`,
  );
  assert.equal(
    inferPlayerFromCardTitle(testCase.title),
    testCase.expected,
    `${testCase.title} title parser failed`,
  );
}

assert.equal(isLikelyPlayerName("Panini Wnba"), false);
assert.equal(isLikelyPlayerName("Artifacts Hockey"), false);
assert.equal(isLikelyPlayerName("Upper Deck"), false);
assert.equal(isLikelyPlayerName("Fleer Shaquille O'Neal"), false);
assert.equal(isLikelyPlayerName("Caitlin Clark Fractal"), false);
assert.equal(isLikelyPlayerName("Reigning Nights"), false);
assert.equal(isLikelyPlayerName("Blue Ref"), false);
assert.equal(isLikelyPlayerName("Caitlin Clark"), true);
assert.equal(isLikelyPlayerName("Mark Stone"), true);
assert.equal(isLikelyPlayerName("Trae Young"), true);
assert.equal(isLikelyPlayerName("Elly De La Cruz"), true);
assert.equal(isLikelyPlayerName("Ed Marinaro"), true);

console.log(
  JSON.stringify({
    success: true,
    casesChecked: cases.length,
    pollutedValuesRejected: 7,
  }),
);
