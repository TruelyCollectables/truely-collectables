import { EbayBrowseAdapter } from "../connectors/tcos-market-intel-mcp/src/public-search.mjs";
import { ebayApplicationTokenService } from "../connectors/tcos-market-intel-mcp/src/ebay-application-token.mjs";

const adapter = new EbayBrowseAdapter();
if (!adapter.configured) {
  throw new Error(
    "Production eBay Browse credentials are unavailable. EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be configured.",
  );
}

const result = await adapter.search({
  query: "Ivan Demidov rookie card",
  sources: ["eBay"],
  filters: {},
  maxResults: 5,
});

if (result.configured !== true) {
  throw new Error("Native eBay Browse adapter did not report configured=true.");
}
if (!Array.isArray(result.results)) {
  throw new Error("Native eBay Browse adapter returned an invalid results payload.");
}

console.log(
  JSON.stringify({
    ok: true,
    adapter: result.source,
    configured: result.configured,
    resultCount: result.results.length,
    token: {
      mode: ebayApplicationTokenService.status().mode,
      environment: ebayApplicationTokenService.status().environment,
      cached: ebayApplicationTokenService.status().cached,
      lastMintAt: ebayApplicationTokenService.status().lastMintAt,
      expiresAt: ebayApplicationTokenService.status().expiresAt,
    },
    sample: result.results.slice(0, 3).map((entry) => ({
      source: entry.source,
      url: entry.url,
      title: entry.title,
      askingPrice: entry.askingPrice,
      shipping: entry.shipping,
      sellerName: entry.sellerName,
    })),
  }),
);
