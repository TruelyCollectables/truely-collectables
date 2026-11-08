import assert from "node:assert/strict";
import { renderKingmakerMorningIntelligenceEmail } from "../src/lib/kingmaker-morning-intelligence-email";
import type { KingmakerMorningIntelligencePayload } from "../src/lib/kingmaker-morning-intelligence";

const payload: KingmakerMorningIntelligencePayload = {
  generatedAt: "2026-08-03T13:00:00.000Z",
  mode: "full",
  shouldDeliver: true,
  fingerprint: "abc123",
  subject: "KINGMAKER Morning Intelligence — 1 action",
  headline: "1 verified opportunity requires owner review.",
  actionableDeals: [
    {
      key: "deal-1",
      title: "Connor <Bedard> exact card",
      detail: "Delivered below ceiling & verified by sold evidence.",
      href: "https://example.test/listing/1",
      severity: "action",
      expectedProfit: 42,
      roiPercent: 38.4,
      confidence: 0.92,
    },
  ],
  meaningfulChanges: [
    {
      key: "change-1",
      title: "Price dropped",
      detail: "Delivered cost improved by $8.",
      severity: "watch",
    },
  ],
  portfolioMovements: [
    {
      key: "position-1",
      title: "Free-roll position available",
      detail: "Sell 3 units to recover deployed capital.",
      href: "https://example.test/admin/position/1",
      movementType: "sell_signal",
      amount: 120,
    },
  ],
  warnings: ["Purchase Ledger sync is 20 minutes old."],
  reason: "material_change",
};

const rendered = renderKingmakerMorningIntelligenceEmail(payload);
assert.equal(rendered.subject, payload.subject);
assert.match(rendered.html, /Project KINGMAKER Beta 1\.0/);
assert.match(rendered.html, /Actionable Deals/);
assert.match(rendered.html, /Portfolio Movement/);
assert.match(rendered.html, /OWNER REVIEW REQUIRED/);
assert.match(rendered.html, /Connor &lt;Bedard&gt; exact card/);
assert.doesNotMatch(rendered.html, /Connor <Bedard>/);
assert.match(rendered.html, /https:\/\/example\.test\/listing\/1/);
assert.match(rendered.text, /Searches discover\. KINGMAKER decides\./);
assert.match(rendered.text, /Expected profit/);

const unsafe: KingmakerMorningIntelligencePayload = {
  ...payload,
  actionableDeals: [
    {
      ...payload.actionableDeals[0],
      href: "javascript:alert(1)",
    },
  ],
};
const unsafeRendered = renderKingmakerMorningIntelligenceEmail(unsafe);
assert.doesNotMatch(unsafeRendered.html, /javascript:alert/);

console.log("KINGMAKER morning intelligence email regressions passed.");
