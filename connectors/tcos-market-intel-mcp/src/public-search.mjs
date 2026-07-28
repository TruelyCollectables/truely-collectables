import { config } from "./config.mjs";
import { normalizeUrl, normalizeText } from "./logic.mjs";

const readResponseText = (payload) => {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const chunks = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
};

const extractJson = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {
        // Continue to bracket extraction.
      }
    }
    const startArray = trimmed.indexOf("[");
    const endArray = trimmed.lastIndexOf("]");
    if (startArray >= 0 && endArray > startArray) {
      try {
        return JSON.parse(trimmed.slice(startArray, endArray + 1));
      } catch {
        return null;
      }
    }
    const startObject = trimmed.indexOf("{");
    const endObject = trimmed.lastIndexOf("}");
    if (startObject >= 0 && endObject > startObject) {
      try {
        return JSON.parse(trimmed.slice(startObject, endObject + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const normalizePublicResult = (entry, sourceFallback = "public_web") => ({
  source: entry.source || sourceFallback,
  url: normalizeUrl(entry.url),
  discoveredAt: entry.discovered_at || entry.discoveredAt || new Date().toISOString(),
  sellerName: entry.seller_name || entry.sellerName || null,
  sellerAccountUrl: normalizeUrl(entry.seller_account_url || entry.sellerAccountUrl || ""),
  location: entry.location || null,
  title: entry.title || "Untitled public listing",
  description: entry.description || null,
  askingPrice: entry.asking_price == null ? entry.askingPrice ?? null : Number(entry.asking_price),
  shipping: entry.shipping == null ? null : Number(entry.shipping),
  buyerFees: entry.buyer_fees == null ? entry.buyerFees ?? null : Number(entry.buyer_fees),
  tax: entry.tax == null ? null : Number(entry.tax),
  quantity: entry.quantity == null ? null : Number(entry.quantity),
  pickupOrShipping: entry.pickup_or_shipping || entry.pickupOrShipping || null,
  paymentMethod: entry.payment_method || entry.paymentMethod || null,
  negotiable: entry.negotiable ?? null,
  imageUrls: Array.isArray(entry.image_urls) ? entry.image_urls : Array.isArray(entry.imageUrls) ? entry.imageUrls : [],
  identity: entry.identity || {},
  certificationNumber: entry.certification_number || entry.certificationNumber || null,
  manualReviewRequired: Boolean(entry.manual_review_required ?? entry.manualReviewRequired),
  verificationNotes: entry.verification_notes || entry.verificationNotes || null,
  rawPayload: entry,
});

const buildPublicSearchPrompt = ({ query, sources, filters, maxResults, exactIdentityOnly }) => `
You are the public-web discovery stage for TCOS Market Intel. Search only publicly accessible pages. Do not bypass logins, private Facebook groups, protected X accounts, private profiles, robots restrictions, or access controls. Do not expose private addresses, phone numbers, or unrelated personal information.

Search request:
- Query: ${query}
- Sources: ${(sources || []).join(", ") || "eBay, Mercari, Whatnot Marketplace, Sportslots, COMC, MySlabs, Fanatics Collect, CollX, public Facebook Marketplace/pages/groups, public X sale posts, Etsy"}
- Filters: ${JSON.stringify(filters || {})}
- Maximum results: ${maxResults}
- Exact identity required: ${exactIdentityOnly ? "yes" : "no; uncertain listings must be marked manual_review_required"}

Search correct spellings, misspellings, last names, initials, teams, card numbers, set/product names, parallels, serial tiers, wrong categories, omitted names, photo-only listings, seller inventories, lots, collections, auctions, relists, and recent posts. For Facebook and X, use public pages/posts only. A login-restricted or incomplete result may be returned only as manual_review_required=true.

Return JSON only as an array of objects with these keys:
source, url, discovered_at, seller_name, seller_account_url, location, title, description, asking_price, shipping, buyer_fees, tax, quantity, pickup_or_shipping, payment_method, negotiable, image_urls, identity, certification_number, manual_review_required, verification_notes.

Identity may contain: sport, player, year, manufacturer, product, set, subset, cardNumber, parallel, variation, serialTier, serialNumber, autograph, memorabilia, rawOrGraded, gradingCompany, grade, certificationNumber.

Critical rules:
- Return only direct public listing/post URLs, never homepages, search-result pages, seller profiles, sold pages represented as live inventory, or generic product pages.
- Do not use a default or teaser price from a multi-variation listing as the exact card price. If selected-card price/image cannot be verified, mark manual_review_required=true and explain why.
- Do not claim a reflective card is Silver, Holo, Ice, Refractor, Mojo, Sapphire, numbered color, or another parallel based on glare alone.
- Do not invent missing prices, shipping, fees, identity, condition, or seller history.
- Deduplicate obvious cross-posts when the same seller/photos/item appear on several sites.
`;

export class OpenAiPublicSearchAdapter {
  get name() {
    return "openai_public_web";
  }

  get configured() {
    return Boolean(config.openAiApiKey);
  }

  async search(request) {
    if (!this.configured) return { source: this.name, configured: false, results: [], warnings: ["OPENAI_API_KEY is not configured"] };
    const maxResults = Math.max(1, Math.min(request.maxResults || config.searchMaxResults, config.searchMaxResults));
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.searchModel,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        input: buildPublicSearchPrompt({ ...request, maxResults }),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI public search failed: ${payload?.error?.message || response.statusText}`);
    }
    const parsed = extractJson(readResponseText(payload));
    const array = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : [];
    return {
      source: this.name,
      configured: true,
      results: array.slice(0, maxResults).map((entry) => normalizePublicResult(entry, this.name)).filter((entry) => entry.url),
      warnings: array.length ? [] : ["Public web search returned no parseable direct listings"],
    };
  }

  async searchComps({ identity, maxResults = 20 }) {
    if (!this.configured) return { configured: false, sales: [], warnings: ["OPENAI_API_KEY is not configured"] };
    const prompt = `
Search the public web for recent completed sales of this exact collectible card identity:
${JSON.stringify(identity)}

Use exact completed/sold results only. Do not use active asking prices as sales. Do not mix different year, manufacturer, product, set, subset, card number, parallel, variation, serial tier, autograph/memorabilia status, raw/graded status, grade, grading company, or condition. Raw and graded must remain separate. If a marketplace has no public sold history, omit it rather than inventing a value.

Return JSON only as an array with at most ${Math.max(1, Math.min(maxResults, 50))} entries. Keys: source, sold_at, sold_price, shipping, total_price, url, exact_match, raw_or_graded, grading_company, grade, notes.
`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.searchModel,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        input: prompt,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenAI comp search failed: ${payload?.error?.message || response.statusText}`);
    const parsed = extractJson(readResponseText(payload));
    const array = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sales) ? parsed.sales : [];
    const sales = array
      .map((sale) => ({
        source: sale.source || "public_web",
        soldAt: sale.sold_at || sale.soldAt,
        soldPrice: Number(sale.sold_price ?? sale.soldPrice),
        shipping: Number(sale.shipping || 0),
        totalPrice: Number(sale.total_price ?? sale.totalPrice ?? Number(sale.sold_price ?? sale.soldPrice) + Number(sale.shipping || 0)),
        url: normalizeUrl(sale.url),
        exactMatch: sale.exact_match ?? sale.exactMatch ?? true,
        rawOrGraded: sale.raw_or_graded || sale.rawOrGraded || null,
        gradingCompany: sale.grading_company || sale.gradingCompany || null,
        grade: sale.grade || null,
        notes: sale.notes || null,
      }))
      .filter((sale) => sale.exactMatch && sale.url && sale.soldAt && Number.isFinite(sale.totalPrice) && sale.totalPrice > 0)
      .slice(0, maxResults);
    return { configured: true, sales, warnings: sales.length ? [] : ["No verified exact completed sales were returned"] };
  }
}

export class EbayBrowseAdapter {
  get name() {
    return "ebay_browse";
  }

  get configured() {
    return Boolean(config.ebayBrowseAccessToken);
  }

  async search(request) {
    if (!this.configured) return { source: this.name, configured: false, results: [], warnings: ["EBAY_BROWSE_ACCESS_TOKEN is not configured"] };
    const limit = Math.max(1, Math.min(request.maxResults || 20, 50));
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", request.query);
    url.searchParams.set("limit", String(limit));
    if (request.filters?.categoryIds?.length) url.searchParams.set("category_ids", request.filters.categoryIds.join(","));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.ebayBrowseAccessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`eBay Browse search failed: ${payload?.errors?.[0]?.message || response.statusText}`);
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
          image_urls: [item.image?.imageUrl, ...(item.thumbnailImages || []).map((image) => image.imageUrl)].filter(Boolean),
          pickup_or_shipping: item.itemLocation ? "shipping_or_pickup_unknown" : null,
          location: [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.country].filter(Boolean).join(", ") || null,
          manual_review_required: Boolean(item.itemGroupType || item.buyingOptions?.includes("AUCTION")),
          verification_notes: item.itemGroupType ? "Potential multi-variation item; selected-card price must be verified" : null,
          raw_payload: item,
        },
        "eBay",
      ),
    );
    return { source: this.name, configured: true, results, warnings: [] };
  }
}

export class XRecentSearchAdapter {
  get name() {
    return "x_recent_search";
  }

  get configured() {
    return Boolean(config.xBearerToken);
  }

  async search(request) {
    if (!this.configured) return { source: this.name, configured: false, results: [], warnings: ["X_BEARER_TOKEN is not configured"] };
    const maxResults = Math.max(10, Math.min(request.maxResults || 20, 100));
    const saleTerms = '("FS" OR "FS/NFT" OR "for sale" OR "below comps" OR "take the lot" OR "priced to move")';
    const query = `${request.query} ${saleTerms} -is:retweet has:links`;
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set("query", query.slice(0, 512));
    url.searchParams.set("max_results", String(maxResults));
    url.searchParams.set("tweet.fields", "created_at,author_id,entities,attachments");
    url.searchParams.set("expansions", "author_id,attachments.media_keys");
    url.searchParams.set("user.fields", "username,created_at,public_metrics");
    url.searchParams.set("media.fields", "url,preview_image_url,type");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.xBearerToken}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(`X recent search failed: ${payload?.detail || payload?.title || response.statusText}`);
    const users = new Map((payload.includes?.users || []).map((user) => [user.id, user]));
    const media = new Map((payload.includes?.media || []).map((entry) => [entry.media_key, entry]));
    const results = (payload.data || []).map((tweet) => {
      const user = users.get(tweet.author_id);
      const urls = tweet.entities?.urls || [];
      const directUrl = `https://x.com/${user?.username || "i"}/status/${tweet.id}`;
      const imageUrls = (tweet.attachments?.media_keys || [])
        .map((key) => media.get(key))
        .flatMap((entry) => [entry?.url, entry?.preview_image_url])
        .filter(Boolean);
      return normalizePublicResult(
        {
          source: "X",
          url: directUrl,
          discovered_at: tweet.created_at,
          seller_name: user?.username || null,
          seller_account_url: user?.username ? `https://x.com/${user.username}` : null,
          title: tweet.text.slice(0, 180),
          description: tweet.text,
          image_urls: imageUrls,
          manual_review_required: !/\$\s?\d|\d+\s?(usd|shipped|obo)/i.test(tweet.text),
          verification_notes: urls.length ? null : "Post does not expose a separate sale page; verify price, shipping, payment protection, and timestamped photos",
          raw_payload: tweet,
        },
        "X",
      );
    });
    return { source: this.name, configured: true, results, warnings: [] };
  }
}

export class PublicSearchService {
  constructor() {
    this.openAi = new OpenAiPublicSearchAdapter();
    this.ebay = new EbayBrowseAdapter();
    this.x = new XRecentSearchAdapter();
  }

  status() {
    return {
      openAiPublicWeb: this.openAi.configured,
      ebayBrowse: this.ebay.configured,
      xRecentSearch: this.x.configured,
      manualPublicUrlIntake: true,
      privateFacebookGroups: false,
      notes: [
        "Private Facebook groups and login-restricted content are never accessed automatically.",
        "Public sources without native APIs are discovered through public web search or manual URL/screenshot intake.",
      ],
    };
  }

  async search(request) {
    const sourceNames = (request.sources || []).map(normalizeText);
    const jobs = [];
    const includesSource = (name) => !sourceNames.length || sourceNames.some((source) => source.includes(name));

    if (includesSource("ebay") && this.ebay.configured) jobs.push(this.ebay.search(request));
    if ((includesSource("x") || includesSource("twitter")) && this.x.configured) jobs.push(this.x.search(request));
    if (this.openAi.configured) jobs.push(this.openAi.search(request));

    if (!jobs.length) {
      return {
        results: [],
        sourceReports: [this.status()],
        warnings: ["No automatic public-search provider is configured. Manual public URL/screenshot intake remains available."],
      };
    }

    const settled = await Promise.allSettled(jobs);
    const results = [];
    const sourceReports = [];
    const warnings = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        sourceReports.push({ source: outcome.value.source, configured: outcome.value.configured, count: outcome.value.results.length });
        results.push(...outcome.value.results);
        warnings.push(...(outcome.value.warnings || []));
      } else {
        warnings.push(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason));
      }
    }

    const byUrl = new Map();
    for (const result of results) {
      if (!result.url) continue;
      const existing = byUrl.get(result.url);
      if (!existing || (existing.manualReviewRequired && !result.manualReviewRequired)) byUrl.set(result.url, result);
    }
    return {
      results: [...byUrl.values()].slice(0, request.maxResults || config.searchMaxResults),
      sourceReports,
      warnings,
    };
  }

  async searchComps(request) {
    return this.openAi.searchComps(request);
  }
}

export const publicSearchService = new PublicSearchService();
