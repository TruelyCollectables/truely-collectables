import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafePublicImageUrl,
  classifyProfitHunterOutcome,
} from "../src/instacomp-bridge.mjs";

test("Profit Hunter classifications fail closed without exact sold pricing", () => {
  assert.equal(
    classifyProfitHunterOutcome({
      trustedResalePrice: 0,
      pricingEligibleSoldCount: 0,
      netProfit: 100,
      roiPercent: 500,
    }).label,
    "SUPPRESSED — NO TRUSTED EXACT SOLD PRICE",
  );
});

test("Profit Hunter classifications enforce the 20 percent net ROI floor", () => {
  assert.equal(
    classifyProfitHunterOutcome({
      trustedResalePrice: 100,
      pricingEligibleSoldCount: 3,
      netProfit: 14,
      roiPercent: 19.99,
    }).label,
    "NO FUCKING WAY / OVERPRICED",
  );
  assert.equal(
    classifyProfitHunterOutcome({
      trustedResalePrice: 100,
      pricingEligibleSoldCount: 3,
      netProfit: 14,
      roiPercent: 20,
    }).label,
    "BORDERLINE BUY",
  );
  assert.equal(
    classifyProfitHunterOutcome({
      trustedResalePrice: 100,
      pricingEligibleSoldCount: 3,
      netProfit: 15,
      roiPercent: 30,
    }).label,
    "MUST BUY",
  );
});

test("Unusually large spreads and unresolved risk require review", () => {
  assert.equal(
    classifyProfitHunterOutcome({
      trustedResalePrice: 100,
      pricingEligibleSoldCount: 3,
      netProfit: 60,
      roiPercent: 60,
    }).label,
    "TOO GOOD TO BE TRUE",
  );
  assert.equal(
    classifyProfitHunterOutcome({
      trustedResalePrice: 100,
      pricingEligibleSoldCount: 3,
      netProfit: 30,
      roiPercent: 35,
      sellerRisk: "high",
    }).purchaseReady,
    false,
  );
});

test("Image downloader blocks unsafe URL classes before network access", async () => {
  await assert.rejects(
    () => assertSafePublicImageUrl("http://images.example.com/card.jpg"),
    /HTTPS/,
  );
  await assert.rejects(
    () => assertSafePublicImageUrl("https://localhost/card.jpg"),
    /Local image hosts/,
  );
  await assert.rejects(
    () => assertSafePublicImageUrl("https://127.0.0.1/card.jpg"),
    /private or unsafe/,
  );
});
