import assert from "node:assert/strict";
import {
  deriveCardIdentity,
  inferPlayerFromCardTitle,
  isLikelyPlayerName,
} from "../src/lib/card-identity";

// Live verification gate for every named player exception in revision v4.
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
assert.equal(isLikelyPlayerName("Caitlin Clark"), true);
assert.equal(isLikelyPlayerName("Mark Stone"), true);
assert.equal(isLikelyPlayerName("Trae Young"), true);
assert.equal(isLikelyPlayerName("Elly De La Cruz"), true);

console.log(
  JSON.stringify({
    success: true,
    casesChecked: cases.length,
    pollutedValuesRejected: 5,
  }),
);
