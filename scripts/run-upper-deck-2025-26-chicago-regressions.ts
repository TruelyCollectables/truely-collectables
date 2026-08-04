import { upperDeck2025_26ChicagoHtmlChecklistAdapter } from "../src/lib/checklist-registry/upper-deck-2025-26-chicago-html";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const html = `<!doctype html><html><body>
<h1>2025-26 Chicago Blackhawks 100th Anniversary Set Checklist Hobby</h1>
<table><tr><th>Set Name</th><th>Card</th><th>Description</th><th>Team City</th><th>Team Name</th><th>Rookie</th><th>Auto</th><th>Mem/Tech</th><th>#'d</th><th>SPs</th><th>Stated Odds</th></tr>
<tr><td>Centennial Choice Signatures</td><td>CS-AA</td><td>Player Alpha</td><td>Chicago</td><td>Blackhawks</td><td></td><td>Auto</td><td></td><td></td><td></td><td>Hobby</td></tr>
<tr><td>Centennial Choice Signatures Inscriptions Parallel</td><td>CS-AA</td><td>Player Alpha - &quot;Alpha One&quot;</td><td>Chicago</td><td>Blackhawks</td><td></td><td>Auto</td><td></td><td>35</td><td></td><td>Hobby</td></tr>
<tr><td>Chicago Stadium Seat Relics</td><td>CS-AA</td><td>Player Alpha</td><td>Chicago</td><td>Blackhawks</td><td></td><td></td><td>Seat Relic</td><td>49</td><td></td><td>Hobby</td></tr>
<tr><td>Chicago Stadium Seat Relics Autos Parallel</td><td>CS-AA</td><td>Player Alpha</td><td>Chicago</td><td>Blackhawks</td><td></td><td>Auto</td><td>Seat Relic</td><td>10</td><td></td><td>Hobby</td></tr>
<tr><td>Centennial Choice Signatures</td><td>CS-BB</td><td>Player Beta</td><td>Chicago</td><td>Blackhawks</td><td></td><td>Auto</td><td></td><td></td><td></td><td>Hobby</td></tr>
<tr><td>Chicago Stadium Seat Relics</td><td>CS-BB</td><td>Player Gamma</td><td>Chicago</td><td>Blackhawks</td><td></td><td></td><td>Seat Relic</td><td>49</td><td></td><td>Hobby</td></tr>
</table></body></html>`;

const artifact: ChecklistSourceArtifact = {
  sourceUrl: "https://upperdeck.com/checklist/chicago-blackhawks-100th-anniversary-set-checklist-hobby/",
  originalFilename: "chicago-blackhawks-100th-anniversary.html",
  mimeType: "text/html",
  content: html,
  retrievedAt: "2026-08-04T14:05:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
};

if (!upperDeck2025_26ChicagoHtmlChecklistAdapter.supports(artifact)) {
  throw new Error("Chicago adapter selection failed");
}
const plan = upperDeck2025_26ChicagoHtmlChecklistAdapter.parse(artifact);
const errors = plan.validation.issues.filter((entry) => entry.severity === "error");
if (plan.validation.status !== "passed" || errors.length) {
  throw new Error(`Chicago normalization failed: ${JSON.stringify(errors)}`);
}

const sets = new Set(plan.sets.map((set) => set.normalizedName));
if (!sets.has("centennial-choice-signatures") || !sets.has("chicago-stadium-seat-relics")) {
  throw new Error(`Set lineage collapsed: ${JSON.stringify([...sets])}`);
}

const alpha = plan.identities.filter(
  (identity) => identity.fingerprint.normalized.cardNumber === "cs-aa",
);
if (alpha.length !== 4) {
  throw new Error(`Expected four Alpha printings: ${JSON.stringify(alpha)}`);
}
const normalized = alpha.map((identity) => identity.fingerprint.normalized);
if (!normalized.some((item) => item.setName === "centennial choice signatures" && item.parallel === "inscriptions" && item.serialRun === "/35" && item.variation === "inscription: alpha one" && item.players.join("|") === "player alpha")) {
  throw new Error(`Inscription evidence failed: ${JSON.stringify(normalized)}`);
}
if (!normalized.some((item) => item.setName === "chicago stadium seat relics" && item.parallel === "base" && item.serialRun === "/49" && item.autographStatus === "non-auto" && item.memorabiliaStatus === "memorabilia")) {
  throw new Error(`Seat relic base failed: ${JSON.stringify(normalized)}`);
}
if (!normalized.some((item) => item.setName === "chicago stadium seat relics" && item.parallel === "autos" && item.serialRun === "/10" && item.autographStatus === "autograph" && item.memorabiliaStatus === "memorabilia")) {
  throw new Error(`Seat relic auto failed: ${JSON.stringify(normalized)}`);
}

const reused = plan.cards.filter((card) => card.cardNumber.toLowerCase() === "cs-bb");
if (reused.length !== 2 || new Set(reused.map((card) => card.setSourceKey)).size !== 2 || new Set(reused.flatMap((card) => card.players)).size !== 2) {
  throw new Error(`Cross-set reuse collapsed: ${JSON.stringify(reused)}`);
}
const fingerprints = plan.identities.map((identity) => identity.fingerprint.fingerprintSha256);
if (new Set(fingerprints).size !== fingerprints.length) {
  throw new Error("Chicago fingerprints are not unique");
}
console.log(JSON.stringify({ status: plan.validation.status, counts: plan.validation.counts, sets: [...sets].sort(), alpha: normalized }, null, 2));
