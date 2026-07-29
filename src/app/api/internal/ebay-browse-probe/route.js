import { timingSafeEqual } from "node:crypto";
import { config } from "../../../../../connectors/tcos-market-intel-mcp/src/config.mjs";
import { ebayApplicationTokenService } from "../../../../../connectors/tcos-market-intel-mcp/src/ebay-application-token.mjs";
import { EbayBrowseAdapter } from "../../../../../connectors/tcos-market-intel-mcp/src/public-search.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""), "utf8");
  const rightBytes = Buffer.from(String(right || ""), "utf8");
  return (
    leftBytes.length > 0 &&
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request) {
  const expected = String(process.env.TCOS_EBAY_PROBE_TOKEN || "").trim();
  const provided = String(
    request.headers.get("x-tcos-ebay-probe-token") || "",
  ).trim();
  if (!safeEqual(provided, expected)) {
    return json({ error: "Unauthorized", code: "EBAY_PROBE_UNAUTHORIZED" }, 401);
  }

  const adapter = new EbayBrowseAdapter();
  if (!adapter.configured) {
    return json(
      {
        ok: false,
        code: "EBAY_BROWSE_NOT_CONFIGURED",
        credentials: {
          clientIdConfigured: Boolean(config.ebayClientId),
          clientSecretConfigured: Boolean(config.ebayClientSecret),
          staticOverrideConfigured: Boolean(config.ebayBrowseAccessToken),
        },
        token: ebayApplicationTokenService.status(),
      },
      503,
    );
  }

  try {
    const result = await adapter.search({
      query: request.nextUrl?.searchParams?.get("q") || "Ivan Demidov rookie card",
      sources: ["eBay"],
      filters: {},
      maxResults: 5,
    });
    return json({
      ok: true,
      adapter: result.source,
      configured: result.configured,
      resultCount: result.results.length,
      token: ebayApplicationTokenService.status(),
      sample: result.results.slice(0, 3).map((entry) => ({
        source: entry.source,
        url: entry.url,
        title: entry.title,
        askingPrice: entry.askingPrice,
        shipping: entry.shipping,
        sellerName: entry.sellerName,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const accessDenied = /access denied|HTTP 403/i.test(message);
    const rateLimited = /rate limit|HTTP 429/i.test(message);
    return json(
      {
        ok: false,
        code: accessDenied
          ? "EBAY_BUY_API_ACCESS_DENIED"
          : rateLimited
            ? "EBAY_BROWSE_RATE_LIMITED"
            : "EBAY_BROWSE_PROBE_FAILED",
        error: message,
        token: ebayApplicationTokenService.status(),
      },
      accessDenied ? 502 : rateLimited ? 429 : 500,
    );
  }
}
