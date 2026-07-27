import assert from "node:assert/strict";
import fs from "node:fs";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  buildSerpApiEbayRequestUrl,
  getExactEbayMarketProviders,
  isSerpApiNoResultsMessage,
  normalizeEbaySerpItems,
} from "../src/lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../src/lib/instacomp-openai-web-market-provider";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";


type FixtureCard = {
  id: string;
  exactTitle: string;
  ai: InstaCompAiResult;
};

type ProviderHealthLane = {
  lane: "sold" | "active";
  query: string;
  httpStatus: number;
  searchStatus: string | null;
  normalNoResults: boolean;
  rawCount: number;
  normalizedCount: number;
  soldDateCount: number;
  success: boolean;
  error: string | null;
};

const CARD_CONCURRENCY = 2;
const PROVIDER_HEALTH_QUERY = "Topps rookie card";

async function probeProviderHealth(lane: "sold" | "active"): Promise<ProviderHealthLane> {
  const apiKey = String(process.env.SERPAPI_API_KEY || "").trim();
  const url = buildSerpApiEbayRequestUrl(PROVIDER_HEALTH_QUERY, lane, apiKey);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => ({}));
    const payloadError = payload?.error;
    const searchStatus =
      typeof payload?.search_metadata?.status === "string"
        ? payload.search_metadata.status
        : null;
    const normalNoResults = isSerpApiNoResultsMessage(payloadError);
    const rows = normalizeEbaySerpItems(payload);
    const searchCompleted =
      response.ok &&
      searchStatus !== "Error" &&
      (!payloadError || normalNoResults);
    const error = searchCompleted
      ? null
      : String(payloadError || response.statusText || "Provider health request failed.");
    return {
      lane,
      query: PROVIDER_HEALTH_QUERY,
      httpStatus: response.status,
      searchStatus,
      normalNoResults,
      rawCount: Array.isArray(payload?.organic_results) ? payload.organic_results.length : 0,
      normalizedCount: rows.length,
      soldDateCount: rows.filter((row) => Boolean(row.soldDate)).length,
      success: searchCompleted && (lane === "sold" || rows.length > 0),
      error,
    };
  } catch (error) {
    return {
      lane,
      query: PROVIDER_HEALTH_QUERY,
      httpStatus: 0,
      searchStatus: null,
      normalNoResults: false,
      rawCount: 0,
      normalizedCount: 0,
      soldDateCount: 0,
      success: false,
      error: error instanceof Error ? error.message : "Provider health request failed.",
    };
  }
}

async function proveCard(
  card: FixtureCard,
  includeOpenAiDiscovery: boolean,
): Promise<Record<string, unknown>> {
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

  // Only deterministic SerpApi rows are eligible for this provider proof.
  // OpenAI web-search rows remain discovery-only and never enter trusted pricing.
  const trusted = mergeExactMarketSources([{ sold: serp.sold, active: serp.active }]);
  const sold = trusted.sold;
  const active = trusted.active;
  const pricingEligibleSoldCount = trusted.pricing.soldCount;
  const failClosedWithoutSold =
    pricingEligibleSoldCount === 0 && trusted.trustedSuggestedPrice === null;
  const soldBackedPriceValid =
    pricingEligibleSoldCount === 0 || Number(trusted.trustedSuggestedPrice || 0) > 0;
  const providerStatuses = [serp.sold.status, serp.active.status];
  const providerConfigurationValid = providerStatuses.every(
    (status) => status !== "not_configured",
  );
  const providerErrorCount = providerStatuses.filter((status) => status === "error").length;
  const providerErrorsFailClosed =
    providerErrorCount === 0 ||
    (pricingEligibleSoldCount === 0 && trusted.trustedSuggestedPrice === null);
  const failureReasons = [
    providerConfigurationValid
      ? ""
      : `provider not configured sold=${serp.sold.status} active=${serp.active.status}`,
    providerErrorsFailClosed ? "" : "provider error produced trusted pricing",
    failClosedWithoutSold ? "" : "missing exact sold evidence produced a suggested price",
    soldBackedPriceValid ? "" : "pricing-eligible sold evidence did not produce a valid price",
  ].filter(Boolean);

  const result = {
    id: card.id,
    identity: card.exactTitle,
    queries: serp.queries,
    soldProviderStatus: serp.sold.status,
    activeProviderStatus: serp.active.status,
    soldMessages: [serp.sold.message].filter(Boolean),
    activeMessages: [serp.active.message].filter(Boolean),
    soldEvidenceCount: sold.length,
    pricingEligibleSoldCount,
    activeEvidenceCount: active.length,
    pricingEligibleActiveCount: trusted.pricing.activeCount,
    trustedSuggestedPrice: trusted.trustedSuggestedPrice,
    pricing: trusted.pricing,
    providerConfigurationValid,
    providerErrorCount,
    providerErrorsFailClosed,
    failClosedWithoutSold,
    soldBackedPriceValid,
    failureReasons,
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
  } satisfies Record<string, unknown>;

  console.log(
    `proof_card_completed=${card.id} sold=${pricingEligibleSoldCount} active=${active.length} status=${trusted.status} provider_errors=${providerErrorCount} fail_closed=${failClosedWithoutSold}`,
  );
  return result;
}

async function main() {
  assert.ok(
    process.env.SERPAPI_API_KEY,
    "SERPAPI_API_KEY is required for the trusted live exact-market provider proof",
  );
  const fixture = JSON.parse(
    fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
  ) as { cards: FixtureCard[] };

  const includeOpenAiDiscovery =
    String(process.env.INSTACOMP_PROOF_INCLUDE_OPENAI_DISCOVERY || "").trim() === "1";
  const startedAt = new Date().toISOString();
  const providerHealthResults = await Promise.all([
    probeProviderHealth("sold"),
    probeProviderHealth("active"),
  ]);
  const cards: Array<Record<string, unknown> | undefined> = new Array(fixture.cards.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= fixture.cards.length) return;
      cards[index] = await proveCard(fixture.cards[index], includeOpenAiDiscovery);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CARD_CONCURRENCY, Math.max(1, fixture.cards.length)) },
      () => worker(),
    ),
  );

  const completedCards = cards.filter(
    (card): card is Record<string, unknown> => Boolean(card),
  );
  const cardFailures = completedCards.filter(
    (card) => Array.isArray(card.failureReasons) && card.failureReasons.length > 0,
  );
  const providerHealthFailures = providerHealthResults.filter((lane) => !lane.success);
  const failClosedCardCount = completedCards.filter(
    (card) => card.failClosedWithoutSold === true,
  ).length;
  const providerErrorHandledCardCount = completedCards.filter(
    (card) => Number(card.providerErrorCount || 0) > 0 && card.providerErrorsFailClosed === true,
  ).length;
  const pricedCardCount = completedCards.filter(
    (card) => Number(card.trustedSuggestedPrice || 0) > 0,
  ).length;
  const proof = {
    schema: "tcos.instacompBatch001LiveMarketProviderProof.v8",
    scope:
      "Live provider endpoint health plus strict rare-card behavior. Empty markets and transient per-query errors are valid only when trusted pricing fails closed.",
    startedAt,
    completedAt: new Date().toISOString(),
    success:
      providerHealthFailures.length === 0 &&
      cardFailures.length === 0 &&
      completedCards.length === fixture.cards.length,
    providerHealth: providerHealthResults,
    cardCount: completedCards.length,
    failClosedCardCount,
    providerErrorHandledCardCount,
    pricedCardCount,
    failures: {
      providerHealth: providerHealthFailures.map((lane) => lane.lane),
      cards: cardFailures.map((card) => ({
        id: card.id,
        reasons: card.failureReasons,
      })),
    },
    cards: completedCards,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-batch-001-live-market-proof.json",
    `${JSON.stringify(proof, null, 2)}\n`,
  );

  assert.equal(
    completedCards.length,
    fixture.cards.length,
    "Live exact-market provider proof did not complete every fixture card",
  );
  assert.deepEqual(
    providerHealthFailures.map((lane) => lane.lane),
    [],
    `Live provider health failed for: ${providerHealthFailures.map((lane) => lane.lane).join(", ")}`,
  );
  assert.deepEqual(
    cardFailures.map((card) => card.id),
    [],
    `Rare-card exact-market safety proof failed for: ${cardFailures.map((card) => card.id).join(", ")}`,
  );
  console.log(
    `InstaComp provider proof passed: sold/active provider endpoints completed successfully; ${completedCards.length}/6 rare cards preserved strict exact matching; ${failClosedCardCount} safely refused pricing without exact sold evidence; ${providerErrorHandledCardCount} transient provider-error case(s) failed closed; ${pricedCardCount} returned sold-backed prices.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
