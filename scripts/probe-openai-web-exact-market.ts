import fs from "node:fs";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import { filterStrictExactMarketMatches } from "../src/lib/instacomp-exact-market-provider";

const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as { cards: Array<{ id: string; exactTitle: string; ai: InstaCompAiResult }> };

type MarketRow = {
  title: string;
  itemPrice: number;
  shippingPrice: number | null;
  deliveredPrice: number;
  url: string;
  imageUrl: string | null;
  soldAt: string | null;
  listedAt: string | null;
};

function directEbayItemUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    if (!/(^|\.)ebay\.com$/i.test(url.hostname)) return null;
    const item = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:\/|$)/i)?.[1];
    return item ? `https://www.ebay.com/itm/${item}` : null;
  } catch {
    return null;
  }
}

function sourceItemIds(payload: any) {
  const ids = new Set<string>();
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    const sources = Array.isArray(item?.action?.sources) ? item.action.sources : [];
    for (const source of sources) {
      const url = directEbayItemUrl(source?.url);
      const id = url?.match(/\/itm\/(\d+)/)?.[1];
      if (id) ids.add(id);
    }
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const url = directEbayItemUrl(annotation?.url || annotation?.url_citation?.url);
        const id = url?.match(/\/itm\/(\d+)/)?.[1];
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

function outputText(payload: any) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((content: any) => content?.type === "output_text" && typeof content?.text === "string")
    .map((content: any) => content.text)
    .join("\n")
    .trim();
}

function schema() {
  const row = {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "itemPrice",
      "shippingPrice",
      "deliveredPrice",
      "url",
      "imageUrl",
      "soldAt",
      "listedAt",
    ],
    properties: {
      title: { type: "string" },
      itemPrice: { type: "number" },
      shippingPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
      deliveredPrice: { type: "number" },
      url: { type: "string" },
      imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      soldAt: { anyOf: [{ type: "string" }, { type: "null" }] },
      listedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["sold", "active", "notes"],
    properties: {
      sold: { type: "array", items: row, maxItems: 10 },
      active: { type: "array", items: row, maxItems: 10 },
      notes: { type: "string" },
    },
  };
}

async function searchCard(card: (typeof fixture.cards)[number]) {
  const body = {
    model: process.env.INSTACOMP_WEB_SEARCH_MODEL || "gpt-5-mini",
    store: false,
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
        filters: { allowed_domains: ["ebay.com"] },
      },
    ],
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a strict sports-card market evidence researcher. Never return similar cards. Player, year, product/set, card number, parallel, print-run denominator, autograph/relic state, raw/graded state, grading company, and grade must match exactly. A /199 card is never evidence for /299. A numbered card is never evidence for an unnumbered card. Only return a direct eBay item URL that your web search opened or cited. Do not invent a URL, price, shipping amount, sale date, listing date, title, or image. Put completed/sold listings only in sold and currently available listings only in active. Return an empty array when exact proof is unavailable.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Find exact eBay sold listings and exact eBay active listings for this card identity:\n${JSON.stringify(
              { exactTitle: card.exactTitle, identity: card.ai },
              null,
              2,
            )}\nUse deliveredPrice = itemPrice + known shipping. If shipping is not shown, use null for shippingPrice and set deliveredPrice equal to itemPrice. Return up to 10 exact sold and 10 exact active direct item pages.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "exact_ebay_market_evidence",
        strict: true,
        schema: schema(),
      },
    },
    max_output_tokens: 5000,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI web search failed (${response.status}): ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  const text = outputText(payload);
  if (!text) throw new Error("OpenAI web search returned no structured text.");
  const parsed = JSON.parse(text) as { sold: MarketRow[]; active: MarketRow[]; notes: string };
  const citedIds = sourceItemIds(payload);

  const normalizeRows = (rows: MarketRow[], lane: "sold" | "active") =>
    rows
      .map((row, index) => {
        const url = directEbayItemUrl(row.url);
        const itemId = url?.match(/\/itm\/(\d+)/)?.[1];
        if (!url || !itemId || !citedIds.has(itemId)) return null;
        const itemPrice = Number(row.itemPrice);
        const shippingPrice = row.shippingPrice === null ? null : Number(row.shippingPrice);
        const deliveredPrice = Number(row.deliveredPrice);
        if (!Number.isFinite(itemPrice) || itemPrice <= 0 || !Number.isFinite(deliveredPrice) || deliveredPrice <= 0) {
          return null;
        }
        if (lane === "sold" && !String(row.soldAt || "").trim()) return null;
        return {
          title: row.title,
          price: deliveredPrice,
          itemPrice,
          shippingPrice,
          priceIncludesShipping: shippingPrice !== null,
          currency: "USD",
          url,
          imageUrl: row.imageUrl,
          source: lane === "sold" ? "openai_web_ebay_sold" : "openai_web_ebay_active",
          sourceLabel: lane === "sold" ? "eBay Sold via OpenAI Web" : "eBay Active via OpenAI Web",
          sourceCategory: lane === "sold" ? ("sold" as const) : ("marketplace" as const),
          soldAt: lane === "sold" ? row.soldAt : null,
          listedAt: lane === "active" ? row.listedAt : null,
          observedAt: new Date().toISOString(),
          index,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    model: payload.model || body.model,
    responseId: payload.id || null,
    citedItemIds: Array.from(citedIds),
    notes: parsed.notes,
    sold: filterStrictExactMarketMatches(normalizeRows(parsed.sold || [], "sold"), card.ai, 20),
    active: filterStrictExactMarketMatches(normalizeRows(parsed.active || [], "active"), card.ai, 20),
    rawSoldCount: Array.isArray(parsed.sold) ? parsed.sold.length : 0,
    rawActiveCount: Array.isArray(parsed.active) ? parsed.active.length : 0,
  };
}

async function main() {
  const cards = [];
  for (const card of fixture.cards) {
    try {
      const result = await searchCard(card);
      cards.push({ id: card.id, exactTitle: card.exactTitle, ...result });
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
