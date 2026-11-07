import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDeliveredCost,
  calculateMaximumOffer,
  calculateResaleOutcome,
  classifyDeal,
  compareListingsForDuplicate,
  computeCompStats,
  evaluateSellerRisk,
  identityKey,
  normalizeUrl,
} from "../src/logic.mjs";

test("normalizes tracking parameters from listing URLs", () => {
  assert.equal(
    normalizeUrl("https://www.ebay.com/itm/123/?utm_source=x&campid=1#photo"),
    "https://www.ebay.com/itm/123",
  );
});

test("exact identity key keeps base, parallel, and grade separate", () => {
  const base = identityKey({
    year: 2025,
    product: "Prizm WNBA",
    player: "Sonia Citron",
    cardNumber: "122",
    parallel: "Base",
    rawOrGraded: "raw",
  });
  const logo = identityKey({
    year: 2025,
    product: "Prizm WNBA",
    player: "Sonia Citron",
    cardNumber: "122",
    parallel: "WNBA Logo",
    rawOrGraded: "raw",
  });
  const psa10 = identityKey({
    year: 2025,
    product: "Prizm WNBA",
    player: "Sonia Citron",
    cardNumber: "122",
    parallel: "WNBA Logo",
    rawOrGraded: "graded",
    gradingCompany: "PSA",
    grade: 10,
  });
  assert.notEqual(base, logo);
  assert.notEqual(logo, psa10);
});

test("deduplicates cross-posts by certification or photo hashes", () => {
  const first = {
    url: "https://example.com/a",
    source: "Facebook Marketplace",
    sellerName: "Dealer One",
    title: "PSA card",
    askingPrice: 100,
    certificationNumber: "12345678",
    photoHashes: ["abc"],
    identity: { player: "Player", cardNumber: "1", grade: 10, gradingCompany: "PSA" },
  };
  const second = { ...first, url: "https://x.com/dealer/status/1", source: "X" };
  const result = compareListingsForDuplicate(first, second);
  assert.equal(result.duplicate, true);
  assert.ok(result.score >= 80);
});

test("calculates full delivered cost and net profit", () => {
  const acquisition = calculateDeliveredCost({ askingPrice: 10, shipping: 2, tax: 1, paymentFees: 0.5 });
  assert.equal(acquisition.deliveredCost, 13.5);
  const resale = calculateResaleOutcome({
    deliveredCost: acquisition.deliveredCost,
    resalePrice: 25,
    buyerShipping: 2,
    sellingFeeRate: 0.1325,
    orderFee: 0.4,
    outboundShipping: 0.78,
    supplies: 0.25,
    returnReserveRate: 0.02,
  });
  assert.ok(resale.netProfit > 7);
  assert.ok(resale.roiPercent > 50);
});

test("maximum offer respects target ROI and fixed acquisition costs", () => {
  const offer = calculateMaximumOffer({
    resalePrice: 20,
    buyerShipping: 2,
    sellingFeeRate: 0.1325,
    orderFee: 0.4,
    outboundShipping: 0.78,
    supplies: 0.25,
    returnReserveRate: 0.02,
    shipping: 1.5,
    acquisitionTaxRate: 0.08,
    targetRoi: 0.1,
  });
  assert.ok(offer.maximumOffer > 10);
  assert.ok(offer.openingOffer < offer.targetOffer);
  assert.ok(offer.targetOffer < offer.maximumOffer);
});

test("comp stats calculate median and preserve latest exact sale", () => {
  const sales = [
    {
      source: "eBay",
      soldAt: "2026-07-20T00:00:00.000Z",
      soldPrice: 10,
      shipping: 2,
      totalPrice: 12,
      url: "https://example.com/1",
    },
    {
      source: "eBay",
      soldAt: "2026-07-10T00:00:00.000Z",
      soldPrice: 14,
      shipping: 0,
      totalPrice: 14,
      url: "https://example.com/2",
    },
    {
      source: "eBay",
      soldAt: "2026-06-20T00:00:00.000Z",
      soldPrice: 20,
      shipping: 0,
      totalPrice: 20,
      url: "https://example.com/3",
    },
  ];
  const stats = computeCompStats(sales, { now: "2026-07-23T00:00:00.000Z" });
  assert.equal(stats.exactSoldCount, 3);
  assert.equal(stats.median, 14);
  assert.equal(stats.latest.totalPrice, 12);
  assert.equal(stats.confidence, "medium");
});

test("seller risk treats unprotected payment and copied photos as high risk", () => {
  const risk = evaluateSellerRisk({
    copiedPhotosSuspected: true,
    timestampedPhotoRefused: true,
    paymentMethod: "PayPal Friends and Family",
  });
  assert.equal(risk.sellerRisk, "high");
  assert.equal(risk.status, "HIGH-RISK / POSSIBLE SCAM");
});

test("deal classifier blocks uncertain identity before profit", () => {
  assert.equal(
    classifyDeal({ identityConfirmed: false, netProfit: 100, roiPercent: 500, sellerRisk: "low" }),
    "MANUAL REVIEW REQUIRED",
  );
  assert.equal(
    classifyDeal({ identityConfirmed: true, netProfit: 30, roiPercent: 50, sellerRisk: "low", isLot: true }),
    "STRONG BUY",
  );
});
