import assert from "node:assert/strict";
import fs from "node:fs";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import { getExactEbayMarketProviders } from "../src/lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../src/lib/instacomp-openai-web-market-provider";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";

type FixtureCard = {
  id: string;
  exactTitle: string;
  ai: InstaCompAiResult;
};

async function main() {
  assert.ok(
    process.env.SERPAPI_API_KEY,
    "SERPAPI_API_KEY is required for the trusted live six-card exact-market provider proof",
  );
  const fixture = JSON.parse(
    fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
  ) as { cards: FixtureCard[] };

  const includeOpenAiDiscovery =
    String(process.env.INSTACOMP_PROOF_INCLUDE_OPENAI_DISCOVERY || "").trim() === "1";
  const startedAt = new Date().toISOString();
  const cards: Array<Record<string, unknown>> = [];
  for (const card of fixture.cards) {
    const serp = await getExactEbayMarketProviders({
      exactTitle: card.exactTitle,
      fallbackQuery: card.exactTitle,
      ai: card.ai,
    });
    const openAi =
      includeOpenAiDiscovery &&
      process.env.OPENAI_API_KEY &&
      (serp.sold.results.length === 0 || serp.active.results.length === 0)
        ? await getOpenAiExactEbayMarketProviders({
            exactTitle: card.exactTitle,
            ai: card.ai,
            bypassCache: true,
          })
        : null;

    // Only the deterministic SerpApi lane is eligible for this provider proof.
    // OpenAI web-search rows remain discovery-only and are never merged into
    // trusted sold pricing or the pass/fail criteria. The optional OpenAI call
    // is disabled by default so it cannot add cost or latency to certification.
    const trusted = mergeExactMarketSources([
      { sold: serp.sold, active: serp.active },
    ]);
    const sold = trusted.sold;
    const active = trusted.active;

    cards.push({
      id: card.id,
      identity: card.exactTitle,
      queries: serp.queries,
      soldProviderStatus: serp.sold.status,
      activeProviderStatus: serp.active.status,
      soldMessages: [serp.sold.message].filter(Boolean),
      activeMessages: [serp.active.message].filter(Boolean),
      soldEvidenceCount: sold.length,
      pricingEligibleSoldCount: trusted.pricing.soldCount,
      activeEvidenceCount: active.length,
      pricingEligibleActiveCount: trusted.pricing.activeCount,
      trustedSuggestedPrice: trusted.trustedSuggestedPrice,
      pricing: trusted.pricing,
      sold: sold.map((comp) => ({
        title: comp.title,
        deliveredPrice: comp.price,
        soldAt: comp.soldAt || null,
        url: comp.url,
        imageUrl: comp.imageUrl,
        matchScore: comp.matchScore,
        flags: comp.flags,
      })),
      active: active.map((comp) => ({
        title: comp.title,
        deliveredPrice: comp.price,
        listedAt: comp.listedAt || null,
        url: comp.url,
        imageUrl: comp.imageUrl,
        matchScore: comp.matchScore,
        flags: comp.flags,
      })),
      providerAttempts: {
        sold: serp.sold.attempts,
        active: serp.active.attempts,
      },
      discoveryOnlyOpenAiWeb: openAi
        ? {
            soldStatus: openAi.sold.status,
            activeStatus: openAi.active.status,
            soldCount: openAi.sold.results.length,
            activeCount: openAi.active.results.length,
            model: openAi.model,
            responseId: openAi.responseId,
            citedItemIds: openAi.citedItemIds,
            notes: openAi.notes,
            cached: openAi.cached,
            trustedForPricing: false,
          }
        : null,
      openAiDiscoveryEnabled: includeOpenAiDiscovery,
    });
  }

  const failures = cards.filter(
    (card) =>
      card.soldProviderStatus !== "live" ||
      card.activeProviderStatus !== "live" ||
      Number(card.pricingEligibleSoldCount || 0) < 1 ||
      Number(card.activeEvidenceCount || 0) < 1 ||
      Number(card.trustedSuggestedPrice || 0) <= 0,
  );
  const proof = {
    schema: "tcos.instacompBatch001LiveMarketProviderProof.v4",
    scope:
      "Live exact-market provider proof. This does not replace the production image-identity and visual-verification route test.",
    startedAt,
    completedAt: new Date().toISOString(),
    success: failures.length === 0,
    cardCount: cards.length,
    failures: failures.map((card) => card.id),
    cards,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-batch-001-live-market-proof.json",
    `${JSON.stringify(proof, null, 2)}\n`,
  );

  assert.equal(
    failures.length,
    0,
    `Live exact-market provider proof is blocked for: ${failures.map((card) => card.id).join(", ")}`,
  );
  console.log(
    `InstaComp Batch 001 provider proof passed: ${cards.length}/6 cards each returned deterministic strict exact sold evidence, exact active competition, and a sold-backed trusted suggested price.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
