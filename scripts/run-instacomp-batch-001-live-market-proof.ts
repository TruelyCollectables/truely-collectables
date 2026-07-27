import assert from "node:assert/strict";
import fs from "node:fs";
import type { InstaCompAiResult, InstaCompComp } from "../src/lib/instacomp";
import { getExactEbayMarketProviders } from "../src/lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../src/lib/instacomp-openai-web-market-provider";
import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";

type FixtureCard = {
  id: string;
  exactTitle: string;
  ai: InstaCompAiResult;
};

function dedupe(values: InstaCompComp[], limit: number) {
  return Array.from(new Map(values.map((row) => [row.url, row])).values()).slice(0, limit);
}

async function main() {
  assert.ok(
    process.env.SERPAPI_API_KEY || process.env.OPENAI_API_KEY,
    "SERPAPI_API_KEY or OPENAI_API_KEY is required for the live six-card exact-market proof",
  );
  const fixture = JSON.parse(
    fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
  ) as { cards: FixtureCard[] };

  const startedAt = new Date().toISOString();
  const cards: Array<Record<string, unknown>> = [];
  for (const card of fixture.cards) {
    const serp = await getExactEbayMarketProviders({
      exactTitle: card.exactTitle,
      fallbackQuery: card.exactTitle,
      ai: card.ai,
    });
    const openAi =
      serp.sold.results.length === 0 || serp.active.results.length === 0
        ? await getOpenAiExactEbayMarketProviders({
            exactTitle: card.exactTitle,
            ai: card.ai,
            bypassCache: true,
          })
        : null;
    const sold = dedupe(
      [...serp.sold.results, ...(openAi?.sold.results || [])],
      20,
    );
    const active = dedupe(
      [...serp.active.results, ...(openAi?.active.results || [])],
      20,
    );
    const pricing = calculateInstaCompSweetSpot({ sold, active });
    const suggestedPrice = sold.length > 0 ? pricing.suggestedPrice : 0;

    cards.push({
      id: card.id,
      identity: card.exactTitle,
      queries: serp.queries,
      soldProviderStatus: sold.length ? "live" : openAi?.sold.status || serp.sold.status,
      activeProviderStatus: active.length ? "live" : openAi?.active.status || serp.active.status,
      soldMessages: [serp.sold.message, openAi?.sold.message].filter(Boolean),
      activeMessages: [serp.active.message, openAi?.active.message].filter(Boolean),
      soldCount: sold.length,
      activeCount: active.length,
      suggestedPrice,
      pricing: { ...pricing, suggestedPrice },
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
      openAiWeb: openAi
        ? {
            model: openAi.model,
            responseId: openAi.responseId,
            citedItemIds: openAi.citedItemIds,
            notes: openAi.notes,
            cached: openAi.cached,
          }
        : null,
    });
  }

  const failures = cards.filter(
    (card) =>
      card.soldProviderStatus !== "live" ||
      card.activeProviderStatus !== "live" ||
      Number(card.soldCount || 0) < 1 ||
      Number(card.activeCount || 0) < 1 ||
      Number(card.suggestedPrice || 0) <= 0,
  );
  const proof = {
    schema: "tcos.instacompBatch001LiveMarketProof.v2",
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
    `Live exact-market proof is blocked for: ${failures.map((card) => card.id).join(", ")}`,
  );
  console.log(
    `InstaComp Batch 001 live proof passed: ${cards.length}/6 cards each returned strict exact sold evidence, strict exact active competition, and a sold-backed suggested price.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
