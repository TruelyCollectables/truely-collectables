import fs from "node:fs";

const path = new URL(
  "../connectors/tcos-market-intel-mcp/src/public-search.mjs",
  import.meta.url,
);
let text = fs.readFileSync(path, "utf8");

const importLine =
  'import { ebayApplicationTokenService } from "./ebay-application-token.mjs";\n';
if (!text.includes(importLine)) {
  const anchor = 'import { config } from "./config.mjs";\n';
  if (!text.includes(anchor)) throw new Error("Public-search config import was not found.");
  text = text.replace(anchor, `${anchor}${importLine}`);
}

const start = text.indexOf("export class EbayBrowseAdapter {");
const end = text.indexOf("export class XRecentSearchAdapter {");
if (start < 0 || end <= start) throw new Error("eBay Browse adapter markers were not found.");

const replacement = `export class EbayBrowseAdapter {
  get name() {
    return "ebay_browse";
  }

  get configured() {
    return ebayApplicationTokenService.configured;
  }

  status() {
    return ebayApplicationTokenService.status();
  }

  async requestSearch(url, accessToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ebayBrowseTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: \`Bearer \${accessToken}\`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw new Error(
          \`eBay Browse request timed out after \${config.ebayBrowseTimeoutMs}ms.\`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(request) {
    if (!this.configured) {
      return {
        source: this.name,
        configured: false,
        results: [],
        warnings: [
          "Native eBay Browse requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.",
        ],
      };
    }

    const limit = Math.max(1, Math.min(request.maxResults || 20, 50));
    const url = new URL(
      \`\${ebayApplicationTokenService.apiBaseUrl()}/buy/browse/v1/item_summary/search\`,
    );
    url.searchParams.set("q", request.query);
    url.searchParams.set("limit", String(limit));
    if (request.filters?.categoryIds?.length) {
      url.searchParams.set("category_ids", request.filters.categoryIds.join(","));
    }

    let accessToken = await ebayApplicationTokenService.getAccessToken();
    let exchange = await this.requestSearch(url, accessToken);
    if (
      exchange.response.status === 401 &&
      ebayApplicationTokenService.status().mode === "client_credentials"
    ) {
      ebayApplicationTokenService.invalidate(accessToken);
      accessToken = await ebayApplicationTokenService.getAccessToken({
        forceRefresh: true,
      });
      exchange = await this.requestSearch(url, accessToken);
    }

    const { response, text } = exchange;
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        \`eBay Browse search returned unreadable JSON (HTTP \${response.status}).\`,
      );
    }

    if (!response.ok) {
      const message =
        payload?.errors?.[0]?.longMessage ||
        payload?.errors?.[0]?.message ||
        payload?.error_description ||
        response.statusText ||
        "unknown error";
      if (response.status === 403) {
        throw new Error(
          \`eBay Browse production access denied (HTTP 403): \${message}. The eBay keyset may require Buy API approval; TCOS will continue public-web eBay discovery without retrying this denied call.\`,
        );
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new Error(
          \`eBay Browse rate limit reached (HTTP 429)\${retryAfter ? \`; retry after \${retryAfter} seconds\` : ""}.\`,
        );
      }
      throw new Error(
        \`eBay Browse search failed (HTTP \${response.status}): \${message}\`,
      );
    }

    const results = (payload.itemSummaries || []).map((item) =>
      normalizePublicResult(
        {
          source: "eBay",
          url: item.itemWebUrl,
          title: item.title,
          asking_price: item.price?.value,
          shipping: item.shippingOptions?.[0]?.shippingCost?.value ?? null,
          quantity: null,
          seller_name: item.seller?.username,
          image_urls: [
            item.image?.imageUrl,
            ...(item.thumbnailImages || []).map((image) => image.imageUrl),
          ].filter(Boolean),
          pickup_or_shipping: item.itemLocation
            ? "shipping_or_pickup_unknown"
            : null,
          location:
            [
              item.itemLocation?.city,
              item.itemLocation?.stateOrProvince,
              item.itemLocation?.country,
            ]
              .filter(Boolean)
              .join(", ") || null,
          manual_review_required: Boolean(
            item.itemGroupType || item.buyingOptions?.includes("AUCTION"),
          ),
          verification_notes: item.itemGroupType
            ? "Potential multi-variation item; selected-card price must be verified"
            : item.buyingOptions?.includes("AUCTION")
              ? "Auction listing; final delivered cost is not fixed"
              : null,
          raw_payload: item,
        },
        "eBay",
      ),
    );
    return {
      source: this.name,
      configured: true,
      results,
      warnings: [],
      diagnostics: this.status(),
    };
  }
}

`;

text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
fs.writeFileSync(path, text);
