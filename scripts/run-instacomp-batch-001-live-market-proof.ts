import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getUniversalEbaySerpProviders,
} from "../src/lib/instacomp-ebay-serp-provider";
import type { InstaCompAiResult, InstaCompComp } from "../src/lib/instacomp";

type FixtureCard = {
  id: string;
  exactTitle: string;
  ai: InstaCompAiResult;
};

if (!process.env.SERPAPI_API_KEY) {
  throw new Error("SERPAPI_API_KEY is required for the live six-card market proof.");
}

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as { cards: FixtureCard[] };

function exactRows(rows: InstaCompComp[]) {
  return rows.filter(
    (row) =>
      !row.flags.includes("guidance comp") &&
      !row.flags.includes("not used for pricing") &&
      !row.flags.some((flag) =>
        /parallel mismatch|not exact parallel|excluded|wrong grade|wrong card/i.test(flag),
      ),
  );
}

const report: Array<Record<string, unknown>> = [];
for (const card of fixture.cards) {
  try {
    const result = await getUniversalEbaySerpProviders({
      exactTitle: card.exactTitle,
      fallbackQuery: card.exactTitle,
      ai: card.ai,
    });
    const sold = exactRows(result.sold.results);
    const active = exactRows(result.active.results);
    report.push({
      id: card.id,
      title: card.exactTitle,
      queries: result.queries,
      soldCount: sold.length,
      activeCount: active.length,
      sold: sold.slice(0, 10).map((row) => ({
        title: row.title,
        deliveredPrice: row.price,
        itemPrice: row.itemPrice ?? null,
        shippingPrice: row.shippingPrice ?? null,
        soldAt: row.soldAt ?? null,
        url: row.url,
        flags: row.flags,
      })),
      active: active.slice(0, 10).map((row) => ({
        title: row.title,
        deliveredPrice: row.price,
        itemPrice: row.itemPrice ?? null,
        shippingPrice: row.shippingPrice ?? null,
        listedAt: row.listedAt ?? null,
        url: row.url,
        flags: row.flags,
      })),
      soldProviderStatus: result.sold.status,
      activeProviderStatus: result.active.status,
      soldMessage: result.sold.message,
      activeMessage: result.active.message,
    });
  } catch (error) {
    report.push({
      id: card.id,
      title: card.exactTitle,
      soldCount: 0,
      activeCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(
  "docs/instacomp-batch-001-live-market-proof.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), cards: report }, null, 2),
);

const failures = report.filter(
  (row) => Number(row.soldCount || 0) < 1 || Number(row.activeCount || 0) < 1,
);
assert.equal(
  failures.length,
  0,
  `Live exact-market proof is blocked for: ${failures.map((row) => row.id).join(", ")}`,
);
console.log(JSON.stringify({ success: true, cards: report }, null, 2));