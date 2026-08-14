import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.EBAY_CLIENT_ID = "cloudflare-contract-client";
process.env.EBAY_CLIENT_SECRET = "cloudflare-contract-secret";
process.env.EBAY_ENVIRONMENT = "production";
delete process.env.EBAY_BROWSE_ACCESS_TOKEN;

const originalFetch = globalThis.fetch;
const calls = [];
let mode = "success";

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });

  if (url.endsWith("/identity/v1/oauth2/token")) {
    if (mode === "token_redirect") {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://redirect.invalid/token" },
      });
    }
    return Response.json({ access_token: "contract-access-token", expires_in: 7200 });
  }

  if (url.includes("/buy/browse/v1/item_summary/search")) {
    if (mode === "browse_redirect") {
      return new Response(null, {
        status: 307,
        headers: { Location: "https://redirect.invalid/browse" },
      });
    }
    return Response.json({
      itemSummaries: [
        {
          itemId: "v1|123456789012|0",
          itemWebUrl: "https://www.ebay.com/itm/123456789012",
          title: "Ivan Demidov Young Guns Rookie",
          price: { value: "19.99", currency: "USD" },
          buyingOptions: ["FIXED_PRICE"],
          image: { imageUrl: "https://i.ebayimg.com/images/g/contract/s-l500.jpg" },
        },
      ],
    });
  }

  throw new Error(`Unexpected fetch URL: ${url}`);
};

try {
  const [{ EbayBrowseAdapter }, { ebayApplicationTokenService }] = await Promise.all([
    import("../connectors/tcos-market-intel-mcp/src/public-search.mjs"),
    import("../connectors/tcos-market-intel-mcp/src/ebay-application-token.mjs"),
  ]);

  const adapter = new EbayBrowseAdapter();
  const result = await adapter.search({
    query: "Ivan Demidov rookie",
    sources: ["eBay"],
    filters: {},
    maxResults: 5,
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, "https://www.ebay.com/itm/123456789012");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.redirect, "manual");
  assert.match(String(calls[0].init.headers.Authorization), /^Basic /);
  assert.equal(calls[1].init.redirect, "manual");
  assert.equal(calls[1].init.headers.Authorization, "Bearer contract-access-token");

  mode = "browse_redirect";
  await assert.rejects(
    adapter.search({
      query: "Ivan Demidov rookie",
      sources: ["eBay"],
      filters: {},
      maxResults: 5,
    }),
    /eBay Browse redirect refused \(HTTP 307\)/,
  );

  ebayApplicationTokenService.invalidate();
  mode = "token_redirect";
  await assert.rejects(
    adapter.search({
      query: "Ivan Demidov rookie",
      sources: ["eBay"],
      filters: {},
      maxResults: 5,
    }),
    /eBay application token redirect refused \(HTTP 302\)/,
  );

  const producerSource = await fs.readFile(
    new URL("./run-truely-deal-hunter-producer.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(producerSource, /vercel\.app/i);
  assert.match(producerSource, /const PRIMARY_HOST = "https:\/\/truelycollectables\.com"/);
  assert.match(producerSource, /for \(const host of \[PRIMARY_HOST\]\)/);
  assert.doesNotMatch(producerSource, /FAILOVER_HOST/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime: "cloudflare-workers",
        tokenRedirectMode: calls[0].init.redirect,
        browseRedirectMode: calls[1].init.redirect,
        redirectsFollowed: false,
        vercelFailoverPresent: false,
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = originalFetch;
}
