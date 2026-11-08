import { ebayApplicationTokenService } from "../../connectors/tcos-market-intel-mcp/src/ebay-application-token.mjs";
import { config } from "../../connectors/tcos-market-intel-mcp/src/config.mjs";

function clampRequestedResults(value) {
  const parsed = Number(value || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function scanLimitFor(requestedResults) {
  return Math.min(50, Math.max(25, requestedResults * 2));
}

function validIsoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeEbayImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/(^|\.)ebayimg\.com$/i.test(url.hostname)) return text;
    url.pathname = url.pathname.replace(
      /\/s-l\d+(?=\.[a-z0-9]+$)/i,
      "/s-l1600",
    );
    return url.toString();
  } catch {
    return text;
  }
}

function ebayImageIdentity(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/(^|\.)ebayimg\.com$/i.test(url.hostname)) return text;
    return `${url.hostname}${url.pathname.replace(
      /\/s-l\d+(?=\.[a-z0-9]+$)/i,
      "/s-lSIZE",
    )}`;
  } catch {
    return text;
  }
}

function preferredListingImages(item) {
  const ordered = [
    item.image?.imageUrl,
    ...(item.additionalImages || []).map((image) => image?.imageUrl),
    ...(item.thumbnailImages || []).map((image) => image?.imageUrl),
  ];
  const seen = new Set();
  const result = [];
  for (const raw of ordered) {
    const normalized = normalizeEbayImageUrl(raw);
    const identity = ebayImageIdentity(normalized);
    if (!normalized || !identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
    if (result.length >= 12) break;
  }
  return result;
}

export function buildDealHunterEbaySearchUrl({
  query,
  maxResults = 20,
  categoryIds = [],
} = {}) {
  const requestedResults = clampRequestedResults(maxResults);
  const scanLimit = scanLimitFor(requestedResults);
  const url = new URL(
    `${ebayApplicationTokenService.apiBaseUrl()}/buy/browse/v1/item_summary/search`,
  );
  url.searchParams.set("q", String(query || "").trim());
  url.searchParams.set("limit", String(scanLimit));
  url.searchParams.set("sort", "newlyListed");
  url.searchParams.set("fieldgroups", "EXTENDED");
  if (Array.isArray(categoryIds) && categoryIds.length) {
    url.searchParams.set("category_ids", categoryIds.map(String).join(","));
  }
  return { url, requestedResults, scanLimit };
}

function normalizeResult(item) {
  const imageUrls = preferredListingImages(item);
  const discoveredAt = validIsoOrNull(
    item.itemOriginDate || item.itemCreationDate,
  );
  const verificationNotes = [];
  if (item.itemGroupType) {
    verificationNotes.push(
      "Potential multi-variation listing; selected-card price and image require verification",
    );
  }
  if (item.buyingOptions?.includes("AUCTION")) {
    verificationNotes.push(
      "Auction listing; final delivered cost is not fixed until the auction closes",
    );
  }

  return {
    source: "eBay",
    url: item.itemWebUrl || null,
    discoveredAt,
    sellerName: item.seller?.username || null,
    location:
      [
        item.itemLocation?.city,
        item.itemLocation?.stateOrProvince,
        item.itemLocation?.country,
      ]
        .filter(Boolean)
        .join(", ") || null,
    title: item.title || "Untitled eBay listing",
    description: item.shortDescription || null,
    askingPrice:
      item.price?.value == null ? null : Number(item.price.value),
    shipping:
      item.shippingOptions?.[0]?.shippingCost?.value == null
        ? null
        : Number(item.shippingOptions[0].shippingCost.value),
    buyerFees: null,
    tax: null,
    imageUrls,
    manualReviewRequired: Boolean(
      item.itemGroupType || item.buyingOptions?.includes("AUCTION"),
    ),
    verificationNotes: verificationNotes.length
      ? verificationNotes.join("; ")
      : null,
    rawPayload: item,
  };
}

export class DealHunterEbayBrowseAdapter {
  get name() {
    return "ebay_browse_deal_hunter";
  }

  get configured() {
    return ebayApplicationTokenService.configured;
  }

  status() {
    return ebayApplicationTokenService.status();
  }

  async rateLimitStatus() {
    if (!this.configured) {
      return { available: false, reason: "not_configured" };
    }
    const accessToken = await ebayApplicationTokenService.getAccessToken();
    const url = new URL(
      `${ebayApplicationTokenService.apiBaseUrl()}/developer/analytics/v1_beta/rate_limit/`,
    );
    url.searchParams.set("api_name", "browse");
    url.searchParams.set("api_context", "buy");
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        available: false,
        httpStatus: response.status,
        reason: payload?.errors?.[0]?.message || response.statusText || "analytics_failed",
      };
    }
    const records = [];
    for (const apiLimit of Array.isArray(payload?.rateLimits) ? payload.rateLimits : []) {
      for (const resource of Array.isArray(apiLimit?.resources) ? apiLimit.resources : []) {
        for (const rate of Array.isArray(resource?.rates) ? resource.rates : []) {
          const finite = (value) => {
            if (value === null || value === undefined || value === "") return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
          };
          records.push({
            resource: String(resource?.name || "unknown"),
            limit: finite(rate?.limit),
            count: finite(rate?.count),
            remaining: finite(rate?.remaining),
            reset: rate?.reset || null,
            timeWindow: rate?.timeWindow || null,
          });
        }
      }
    }
    const searchRecords = records.filter((row) => /search|item_summary/i.test(row.resource));
    const candidates = searchRecords.length ? searchRecords : records;
    const finiteRemaining = candidates
      .map((row) => row.remaining)
      .filter((value) => Number.isFinite(value));
    return {
      available: true,
      remaining: finiteRemaining.length ? Math.min(...finiteRemaining) : null,
      records: candidates,
    };
  }

  async requestSearch(url, accessToken) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.ebayBrowseTimeoutMs,
    );
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error(
          `eBay Browse redirect refused (HTTP ${response.status}).`,
        );
      }
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw new Error(
          `eBay Browse request timed out after ${config.ebayBrowseTimeoutMs}ms.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(request = {}) {
    if (!this.configured) {
      return {
        source: this.name,
        configured: false,
        results: [],
        warnings: [
          "Native eBay Browse requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.",
        ],
        diagnostics: this.status(),
      };
    }

    const { url, requestedResults, scanLimit } = buildDealHunterEbaySearchUrl({
      query: request.query,
      maxResults: request.maxResults,
      categoryIds: request.filters?.categoryIds || [],
    });

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
        `eBay Browse search returned unreadable JSON (HTTP ${response.status}).`,
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
          `eBay Browse production access denied (HTTP 403): ${message}.`,
        );
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new Error(
          `eBay Browse rate limit reached (HTTP 429)${
            retryAfter ? `; retry after ${retryAfter} seconds` : ""
          }.`,
        );
      }
      throw new Error(
        `eBay Browse search failed (HTTP ${response.status}): ${message}`,
      );
    }

    const itemSummaries = Array.isArray(payload.itemSummaries)
      ? payload.itemSummaries
      : [];
    return {
      source: this.name,
      configured: true,
      results: itemSummaries.map(normalizeResult).filter((entry) => entry.url),
      warnings: [],
      diagnostics: {
        ...this.status(),
        sortApplied: "newlyListed",
        fieldgroups: "EXTENDED",
        requestedResultLimit: requestedResults,
        screenedScanLimit: scanLimit,
        apiResultCount: itemSummaries.length,
      },
    };
  }
}
