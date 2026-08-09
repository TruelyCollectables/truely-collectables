import assert from "node:assert/strict";
import {
  parsePsaAprHtmlChecklist,
  psaAprHtmlChecklistAdapter,
} from "../src/lib/checklist-registry/psa-apr-html";

const targetContext = {
  targetKey: "basketball|2010|panini|elite-black-box",
  sport: "basketball",
  year: "2010",
  season: "2010",
  manufacturer: "panini",
  product: "elite black box",
};

function artifact(html: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl:
      "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090",
    originalFilename: "2010-panini-elite-black-box.html",
    mimeType: "text/html",
    content: html,
    retrievedAt: "2026-08-08T20:00:00.000Z",
    authority: "approved_reference_dataset" as const,
    redistributionAllowed: false,
    targetContext,
    ...overrides,
  };
}

const completeHtml = `
<html>
  <body>
    <h1>2010 Panini Elite Black Box</h1>
    <h2>Items in Set</h2>
    <table>
      <tr><th>No.</th><th>Subject</th><th>Auction Results</th></tr>
      <tr><td>1</td><td>LeBron James Status</td><td>12</td></tr>
      <tr><td>3</td><td>Kevin Durant Status Autograph</td><td>8</td></tr>
      <tr><td>4</td><td>Kobe Bryant Jersey</td><td>5</td></tr>
      <tr><td>45</td><td>Stephen Curry Status Aspirations</td><td>14</td></tr>
      <tr><td>50</td><td>Dwyane Wade Status</td><td>6</td></tr>
    </table>
  </body>
</html>`;

const plan = parsePsaAprHtmlChecklist(artifact(completeHtml));
assert.equal(plan.validation.status, "passed");
assert.equal(plan.cards.length, 5);
assert.equal(plan.identities.length, 5);
assert.equal(plan.release.manufacturer, "panini");
assert.equal(plan.release.product, "elite black box");
assert.equal(plan.cards[0].cardNumber, "1");
assert.deepEqual(plan.cards[0].players, ["LeBron James"]);
assert.equal(plan.cards[0].variation, "Status");
assert.equal(plan.cards[1].autographStatus, "autograph");
assert.equal(plan.cards[2].memorabiliaStatus, "memorabilia");
assert.equal(plan.cards[3].variation, "Status Aspirations");
assert.ok(plan.parallels.some((parallel) => parallel.name === "Status"));
assert.ok(plan.parallels.some((parallel) => parallel.name === "Status Aspirations"));

const paginated = parsePsaAprHtmlChecklist(
  artifact(
    completeHtml.replace(
      "</table>",
      '</table><a rel="next" href="?page=2">Next</a>',
    ),
  ),
);
assert.equal(paginated.validation.status, "validation_required");
assert.ok(
  paginated.validation.issues.some(
    (issue) => issue.code === "psa_apr_pagination_incomplete" && issue.severity === "error",
  ),
);

const mismatch = parsePsaAprHtmlChecklist(
  artifact(completeHtml, {
    targetContext: { ...targetContext, product: "prestige" },
  }),
);
assert.equal(mismatch.validation.status, "validation_required");
assert.ok(
  mismatch.validation.issues.some(
    (issue) => issue.code === "psa_target_identity_mismatch",
  ),
);

assert.equal(
  psaAprHtmlChecklistAdapter.supports(
    artifact(completeHtml, {
      sourceUrl: "https://www.psacard.com/priceguide/basketball-cards/2010-panini-elite-black-box/101090",
    }),
  ),
  false,
);

console.log("PSA APR checklist adapter fail-closed simulations passed.");
