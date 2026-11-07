import { upperDeck2025_26OpcHtmlChecklistAdapter } from "../src/lib/checklist-registry/upper-deck-2025-26-opc-html";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const html = `<!doctype html>
<html>
  <head><title>2025-26 O-Pee-Chee Checklist</title></head>
  <body>
    <h1>2025-26 O-Pee-Chee Checklist</h1>
    <table>
      <thead>
        <tr>
          <th>Set Name</th><th>Card</th><th>Description</th><th>Team City</th>
          <th>Team Name</th><th>Rookie</th><th>Auto</th><th>Tech</th>
          <th>#'d</th><th>Stated Odds</th><th>Pt</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>2025-26 O-Pee-Chee Platinum Previews</td><td>P-1</td><td>Connor McDavid</td><td>Edmonton</td><td>Oilers</td><td></td><td></td><td></td><td></td><td>Random Inserts in Hobby Packs</td><td>27</td></tr>
        <tr><td>2025-26 O-Pee-Chee Platinum Previews Rainbow Parallel</td><td>P-1</td><td>Connor McDavid</td><td>Edmonton</td><td>Oilers</td><td></td><td></td><td></td><td></td><td>Random Inserts in Hobby Packs</td><td>27</td></tr>
        <tr><td>2025-26 O-Pee-Chee Platinum Previews Sunset Parallel</td><td>P-1</td><td>Connor McDavid</td><td>Edmonton</td><td>Oilers</td><td></td><td></td><td></td><td></td><td>Random Inserts in Hobby Packs</td><td>27</td></tr>
        <tr><td>2025-26 O-Pee-Chee Platinum Previews Violet Pixels Parallel</td><td>P-2</td><td>Auston Matthews</td><td>Toronto</td><td>Maple Leafs</td><td></td><td></td><td></td><td>99</td><td>Random Inserts in Hobby Packs</td><td>27</td></tr>
        <tr><td>Playing Cards</td><td>JOKER</td><td>SJ Sharkie</td><td>San Jose</td><td>Sharks</td><td></td><td></td><td></td><td></td><td>1:203 Hobby</td><td>12</td></tr>
        <tr><td>Playing Cards</td><td>JOKER</td><td>Carlton the Bear</td><td>Toronto</td><td>Maple Leafs</td><td></td><td></td><td></td><td></td><td>1:203 Hobby</td><td>12</td></tr>
      </tbody>
    </table>
  </body>
</html>`;

const artifact: ChecklistSourceArtifact = {
  sourceUrl: "https://upperdeck.com/checklist/2025-26-o-pee-chee-checklist/",
  originalFilename: "2025-26-o-pee-chee.html",
  mimeType: "text/html",
  content: html,
  retrievedAt: "2026-08-04T13:35:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
};

if (!upperDeck2025_26OpcHtmlChecklistAdapter.supports(artifact)) {
  throw new Error("The narrow O-Pee-Chee adapter did not select the official source.");
}

const plan = upperDeck2025_26OpcHtmlChecklistAdapter.parse(artifact);
const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
if (plan.validation.status !== "passed" || errors.length) {
  throw new Error(`O-Pee-Chee normalization failed: ${JSON.stringify(errors)}`);
}

const p1 = plan.identities.filter(
  (identity) => identity.fingerprint.normalized.cardNumber === "p-1",
);
const p1Parallels = new Set(
  p1.map((identity) => identity.fingerprint.normalized.parallel),
);
if (
  p1.length !== 3 ||
  !p1Parallels.has("base") ||
  !p1Parallels.has("rainbow") ||
  !p1Parallels.has("sunset")
) {
  throw new Error(
    `P-1 printings collapsed or were mislabeled: ${JSON.stringify(
      p1.map((identity) => identity.fingerprint.normalized),
    )}`,
  );
}

const violet = plan.identities.find(
  (identity) =>
    identity.fingerprint.normalized.cardNumber === "p-2" &&
    identity.fingerprint.normalized.parallel === "violet pixels" &&
    identity.fingerprint.normalized.serialRun === "/99",
);
if (!violet) {
  throw new Error("The Violet Pixels /99 printing was not normalized exactly.");
}

const jokers = plan.cards.filter(
  (card) => card.cardNumber.toLowerCase() === "joker",
);
if (
  jokers.length !== 2 ||
  new Set(jokers.map((card) => card.variation)).size !== 2 ||
  jokers.some((card) => !card.variation?.startsWith("Subject: "))
) {
  throw new Error(
    `Legitimate reused JOKER numbers were not subject-disambiguated: ${JSON.stringify(
      jokers,
    )}`,
  );
}

if (
  new Set(
    plan.identities.map((identity) => identity.fingerprint.fingerprintSha256),
  ).size !== plan.identities.length
) {
  throw new Error("O-Pee-Chee normalized identities are not unique.");
}

console.log(
  JSON.stringify(
    {
      adapter: {
        id: upperDeck2025_26OpcHtmlChecklistAdapter.id,
        version: upperDeck2025_26OpcHtmlChecklistAdapter.version,
      },
      status: plan.validation.status,
      counts: plan.validation.counts,
      p1Parallels: [...p1Parallels].sort(),
      jokerVariations: jokers.map((card) => card.variation).sort(),
    },
    null,
    2,
  ),
);
