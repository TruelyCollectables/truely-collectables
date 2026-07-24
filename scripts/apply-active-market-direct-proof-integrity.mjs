import fs from "node:fs";

const auditFile = "src/lib/active-market-integrity-audit.ts";
let audit = fs.readFileSync(auditFile, "utf8");
const auditCheck = `    if (candidate.directProofConfirmed !== true) {
      pushUnique(failures, "verified_competitor_missing_direct_item_proof");
    }
`;
if (!audit.includes("verified_competitor_missing_direct_item_proof")) {
  const anchor = `    const identifiers = candidateIdentifiers(candidate);

`;
  if (!audit.includes(anchor)) {
    throw new Error("Could not find integrity competitor-loop anchor.");
  }
  audit = audit.replace(anchor, `${anchor}${auditCheck}\n`);
}
fs.writeFileSync(auditFile, audit);

const testFile = "scripts/run-active-market-integrity-simulations.ts";
let test = fs.readFileSync(testFile, "utf8");
if (!test.includes("directProofConfirmed: true")) {
  const anchor = `  matchLevel: "exact",
  url: "https://www.ebay.com/itm/111",
`;
  if (!test.includes(anchor)) {
    throw new Error("Could not find valid competitor fixture anchor.");
  }
  test = test.replace(
    anchor,
    `  matchLevel: "exact",\n  directProofConfirmed: true,\n  url: "https://www.ebay.com/itm/111",\n`,
  );
}

const scenario = `  {
    name: "verified competitor without direct item proof blocks pricing",
    attack: validAttack({
      competitors: [{ ...competitor, directProofConfirmed: false }],
      lowestCompetitor: { ...competitor, directProofConfirmed: false },
    }),
    tracking: validTracking(
      validAttack({
        competitors: [{ ...competitor, directProofConfirmed: false }],
        lowestCompetitor: { ...competitor, directProofConfirmed: false },
      }),
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "verified_competitor_missing_direct_item_proof",
  },
`;
if (!test.includes("verified competitor without direct item proof blocks pricing")) {
  const anchor = `  {
    name: "ripped listing left in scouting blocks pricing",
`;
  if (!test.includes(anchor)) {
    throw new Error("Could not find integrity scenario insertion anchor.");
  }
  test = test.replace(anchor, `${scenario}${anchor}`);
}
fs.writeFileSync(testFile, test);

console.log("Direct competitor proof requirement added to integrity audit.");
