import fs from "node:fs";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  buildExactEbayQueryLadder,
  filterStrictExactMarketMatches,
} from "../src/lib/instacomp-exact-market-provider";

const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
const clientSecret = String(process.env.EBAY_CLIENT_SECRET || "").trim();
if (!clientId || !clientSecret) throw new Error("eBay client credentials are not configured.");

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as { cards: Array<{ id: string; exactTitle: string; ai: InstaCompAiResult }> };

async function token() {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(`eBay OAuth failed (${response.status}): ${JSON.stringify(payload).slice(0, 600)}`);
  }
  return String(payload.access_token);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function search(accessToken: string, query: string) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "newlyListed");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=80134",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { status: response.status, error: payload, rows: [] as any[] };
  }
  const rows = (Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : [])
    .map((item: any) => {
      const itemPrice = number(item?.price?.value);
      const shippingPrice = number(item?.shippingOptions?.[0]?.shippingCost?.value);
      if (!itemPrice || !item?.title || !item?.itemWebUrl) return null;
      return {
        title: String(item.title),
        price: Math.round((itemPrice + (shippingPrice || 0)) * 100) / 100,
        itemPrice,
        shippingPrice,
        priceIncludesShipping: shippingPrice !== null,
        currency: String(item?.price?.currency || "USD"),
        url: String(item.itemWebUrl),
        imageUrl: typeof item?.image?.imageUrl === "string" ? item.image.imageUrl : null,
        source: "ebay_browse_active",
        sourceLabel: "eBay Active",
        sourceCategory: "marketplace" as const,
        listedAt: typeof item?.itemCreationDate === "string" ? item.itemCreationDate : null,
        observedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);
  return { status: response.status, error: null, rows };
}

async function main() {
  const accessToken = await token();
  const cards = [];
  for (const card of fixture.cards) {
    const queries = buildExactEbayQueryLadder({
      exactTitle: card.exactTitle,
      fallbackQuery: card.exactTitle,
      ai: card.ai,
    });
    let exact: any[] = [];
    const attempts = [];
    for (const query of queries) {
      const result = await search(accessToken, query);
      const accepted = filterStrictExactMarketMatches(result.rows, card.ai, 30);
      exact = Array.from(
        new Map([...exact, ...accepted].map((row) => [row.url, row])).values(),
      );
      attempts.push({
        query,
        httpStatus: result.status,
        rawCount: result.rows.length,
        exactCount: accepted.length,
        error: result.error,
      });
      if (exact.length >= 5) break;
    }
    cards.push({
      id: card.id,
      exactTitle: card.exactTitle,
      exactCount: exact.length,
      attempts,
      exact: exact.map((row) => ({
        title: row.title,
        deliveredPrice: row.price,
        itemPrice: row.itemPrice,
        shippingPrice: row.shippingPrice,
        url: row.url,
        imageUrl: row.imageUrl,
        matchScore: row.matchScore,
        flags: row.flags,
      })),
    });
  }
  const proof = {
    generatedAt: new Date().toISOString(),
    provider: "ebay_browse_active",
    cardsWithExactActive: cards.filter((card) => card.exactCount > 0).length,
    cards,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-ebay-browse-active-probe.json",
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.cardsWithExactActive) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
