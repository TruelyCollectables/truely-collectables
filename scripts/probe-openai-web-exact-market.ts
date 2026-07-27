import fs from "node:fs";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import { getOpenAiExactEbayMarketProviders } from "../src/lib/instacomp-openai-web-market-provider";

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as { cards: Array<{ id: string; exactTitle: string; ai: InstaCompAiResult }> };

async function main() {
  const cards = [];
  for (const card of fixture.cards) {
    try {
      const result = await getOpenAiExactEbayMarketProviders({
        exactTitle: card.exactTitle,
        ai: card.ai,
        bypassCache: true,
      });
      cards.push({
        id: card.id,
        exactTitle: card.exactTitle,
        model: result.model,
        responseId: result.responseId,
        notes: result.notes,
        citedItemIds: result.citedItemIds,
        sold: result.sold.results,
        active: result.active.results,
        soldStatus: result.sold.status,
        activeStatus: result.active.status,
        soldMessage: result.sold.message,
        activeMessage: result.active.message,
      });
    } catch (error) {
      cards.push({
        id: card.id,
        exactTitle: card.exactTitle,
        error: error instanceof Error ? error.message : String(error),
        sold: [],
        active: [],
      });
    }
  }
  const proof = {
    generatedAt: new Date().toISOString(),
    provider: "openai_responses_web_search_ebay_exact",
    cards,
    cardsWithSold: cards.filter((card: any) => card.sold?.length > 0).length,
    cardsWithActive: cards.filter((card: any) => card.active?.length > 0).length,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-openai-web-exact-market-probe.json",
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.cardsWithSold && !proof.cardsWithActive) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
