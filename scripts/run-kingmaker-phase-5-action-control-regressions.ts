import assert from "node:assert/strict";
import {
  authorizeKingmakerAction,
  signKingmakerOwnerAuthorization,
  summarizeKingmakerActionQueue,
  transitionKingmakerAction,
  validateKingmakerActionProposal,
  type KingmakerActionProposal,
} from "../src/lib/kingmaker-phase-5-action-control";

const now = new Date("2026-08-03T06:00:00Z");
const secret = "phase-5-owner-authorization-secret-123456789";
const proposal: KingmakerActionProposal = {
  actionId: "action-1",
  decisionFingerprint: "decision-1",
  entityKey: "hockey:demidov:young-guns:201:raw",
  source: "ebay",
  action: "offer",
  amount: 31,
  currency: "usd",
  sourceUrl: "https://www.ebay.com/itm/123",
  proposedAt: "2026-08-03T05:55:00Z",
  expiresAt: "2026-08-03T06:30:00Z",
  riskScore: 18,
  confidence: 0.91,
  expectedProfit: 20,
  expectedRoiPercent: 64.5,
};

const normalized = validateKingmakerActionProposal(proposal, now);
assert.equal(normalized.currency, "USD");
assert.equal(normalized.amount, 31);
assert.equal(normalized.sourceUrl, "https://www.ebay.com/itm/123");

const authorization = signKingmakerOwnerAuthorization({
  proposal: normalized,
  ownerId: "owner-1",
  authorizedAt: "2026-08-03T06:00:00Z",
  expiresAt: "2026-08-03T06:10:00Z",
  nonce: "nonce-1",
  secret,
});
const authorized = authorizeKingmakerAction({ proposal: normalized, authorization, secret, now });
assert.equal(authorized.state, "authorized");
assert.equal(authorized.authorizationFingerprint.length, 64);

assert.throws(() => authorizeKingmakerAction({
  proposal: normalized,
  authorization: { ...authorization, signature: authorization.signature.replace(/^./, "0") },
  secret,
  now,
}), /authorization_signature_invalid/);

assert.throws(() => authorizeKingmakerAction({
  proposal: normalized,
  authorization,
  secret,
  now,
  usedNonces: new Set(["nonce-1"]),
}), /authorization_nonce_replayed/);

assert.throws(() => validateKingmakerActionProposal({
  ...proposal,
  actionId: "high-risk",
  riskScore: 75,
}, now), /risk_too_high_for_execution/);

assert.throws(() => validateKingmakerActionProposal({
  ...proposal,
  actionId: "low-confidence",
  confidence: 0.4,
}, now), /confidence_too_low_for_execution/);

assert.throws(() => validateKingmakerActionProposal({
  ...proposal,
  actionId: "unsafe-url",
  sourceUrl: "javascript:alert(1)",
}, now), /source_url_unsafe/);

assert.throws(() => validateKingmakerActionProposal({
  ...proposal,
  actionId: "expired",
  expiresAt: "2026-08-03T05:59:00Z",
}, now), /proposal_expired/);

const authorizedTransition = transitionKingmakerAction({
  actionId: proposal.actionId,
  from: "proposed",
  to: "authorized",
  occurredAt: "2026-08-03T06:00:00Z",
  reason: "owner_approved",
});
assert.equal(authorizedTransition.fingerprint.length, 64);
assert.throws(() => transitionKingmakerAction({
  actionId: proposal.actionId,
  from: "proposed",
  to: "succeeded",
  occurredAt: "2026-08-03T06:00:00Z",
  reason: "skip",
}), /action_transition_invalid/);

const queue = summarizeKingmakerActionQueue([
  proposal,
  { ...proposal, actionId: "watch-1", action: "watch", amount: null, expectedProfit: null, expectedRoiPercent: null },
  { ...proposal, actionId: "bad-1", action: "buy", amount: 0 },
], now);
assert.equal(queue.received, 3);
assert.equal(queue.accepted.length, 2);
assert.equal(queue.rejected.length, 1);
assert.equal(queue.executable, 1);
assert.equal(queue.fingerprint.length, 64);

console.log("KINGMAKER Phase 5 action control regressions passed.");
