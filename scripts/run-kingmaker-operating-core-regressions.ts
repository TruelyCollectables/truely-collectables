import assert from "node:assert/strict";
import { assessKingmakerRisk } from "../src/lib/kingmaker-risk-engine";
import { validateKingmakerLifecycle } from "../src/lib/kingmaker-opportunity-lifecycle";
import { analyzeKingmakerPortfolio } from "../src/lib/kingmaker-portfolio-brain";
import { recommendKingmakerOffer } from "../src/lib/kingmaker-offer-engine";
import { orchestrateKingmakerCandidate } from "../src/lib/kingmaker-universal-orchestrator";

const lowRisk = assessKingmakerRisk({ sellerReliability: 0.95, cancellationRate: 0.01, issueRate: 0.01, imageQuality: 0.95, descriptionCompleteness: 0.95, volatility: 0.2 });
assert.equal(lowRisk.level, "low");
const critical = assessKingmakerRisk({ counterfeitSignals: 1, sellerReliability: 0.2 });
assert.equal(critical.level, "critical");
assert.ok(critical.blockers.includes("counterfeit_signal"));

const lifecycle = validateKingmakerLifecycle([
  { opportunityKey: "a", stage: "detected", occurredAt: "2026-08-01T10:00:00Z", actor: "system" },
  { opportunityKey: "a", stage: "verified", occurredAt: "2026-08-01T10:05:00Z", actor: "system" },
  { opportunityKey: "a", stage: "purchased", occurredAt: "2026-08-01T11:00:00Z", actor: "owner", amount: 25 },
  { opportunityKey: "a", stage: "sold", occurredAt: "2026-08-10T11:00:00Z", actor: "marketplace", amount: 60 },
]);
assert.equal(lifecycle.valid, true);
assert.equal(lifecycle.currentStage, "sold");

const portfolio = analyzeKingmakerPortfolio([
  { positionKey: "p1", category: "hockey", subject: "Demidov", quantity: 2, landedCost: 20, marketValue: 40, confidence: 0.9, liquidity: 0.8, volatility: 0.2, acquiredAt: "2026-07-01T00:00:00Z" },
  { positionKey: "p2", category: "hockey", subject: "Celebrini", quantity: 1, landedCost: 30, marketValue: 25, confidence: 0.7, liquidity: 0.4, volatility: 0.6, acquiredAt: "2026-01-01T00:00:00Z" },
], new Date("2026-08-03T00:00:00Z"));
assert.equal(portfolio.deployedCapital, 70);
assert.equal(portfolio.estimatedMarketValue, 105);
assert.ok(portfolio.warnings.includes("category_concentration:hockey"));

const offer = recommendKingmakerOffer({ askingPrice: 40, marketValue: 70, minimumProfit: 15, minimumRoiPercent: 30, sellerAcceptanceRate: 0.7, sellerReliability: 0.9, shippingAndFees: 5, riskScore: 10 });
assert.equal(offer.action, "offer");
assert.ok(offer.recommendedOffer < offer.walkAwayPrice);

const approved = orchestrateKingmakerCandidate({ opportunityKey: "deal-1", source: "ebay", verified: true, expectedProfit: 30, expectedRoiPercent: 75, confidence: 0.9, askingPrice: 40, marketValue: 75, shippingAndFees: 5, sellerAcceptanceRate: 0.7, risk: { sellerReliability: 0.95, imageQuality: 0.9, descriptionCompleteness: 0.9, volatility: 0.2 } });
assert.equal(approved.status, "offer");
assert.equal(approved.blockers.length, 0);
const blocked = orchestrateKingmakerCandidate({ opportunityKey: "deal-2", source: "mercari", verified: true, expectedProfit: 50, expectedRoiPercent: 100, confidence: 0.9, askingPrice: 20, marketValue: 70, risk: { counterfeitSignals: 1 } });
assert.equal(blocked.status, "withheld");
assert.ok(blocked.blockers.includes("critical_risk"));

console.log("KINGMAKER operating core regressions passed.");
