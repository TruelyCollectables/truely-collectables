import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { deriveCardIdentity } from "../../../../../../lib/card-identity";
import { postInstaCompMacAccounting } from "../../../../../../lib/instacomp-mac-accounting-client";
import { detectCardNumberFromTitle } from "../../../../../../lib/market-intel-card-number-enrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type EbayAspect = { name?: string; value?: string };
type EbayItem = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  localizedAspects?: EbayAspect[];
  seller?: { username?: string };
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  errors?: Array<{ message?: string; longMessage?: string }>;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

async function requireSeller(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return null;
  await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
  return account;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function aspect(aspects: EbayAspect[] | undefined, ...names: string[]) {
  const wanted = names.map((value) => value.toLowerCase());
  for (const row of aspects || []) {
    const name = clean(row.name).toLowerCase();
    if (wanted.includes(name)) return clean(row.value) || null;
  }
  return null;
}

function yes(value: unknown) {
  return /^(yes|true|1)$/i.test(clean(value));
}

function ebayLegacyId(url: URL) {
  return url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?]|$)/i)?.[1]
    || url.searchParams.get("item")?.match(/^\d{9,15}$/)?.[0]
    || null;
}

async function syncedPurchaseByEbayItemId(legacyId: string) {
  try {
    const data = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/pending-purchases",
      { cutoff: "2020-01-01" },
      15_000,
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.find((item: Record<string, any>) =>
      clean(item.sourceItemId) === legacyId ||
      clean(item.listingUrl).includes(`/itm/${legacyId}`),
    ) || null;
  } catch {
    return null;
  }
}

function identityFromSyncedPurchase(item: Record<string, any>) {
  return {
    player: clean(item.player),
    year: clean(item.year),
    brand: clean(item.brand),
    setName: clean(item.setName),
    cardNumber: clean(item.cardNumber),
    parallel: clean(item.parallel) || "Base",
    serialNumber: clean(item.serialFamily),
    isAuto: item.isAuto === true,
    isRelic: item.isRelic === true,
  };
}

async function ebayToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const clientId = clean(process.env.EBAY_CLIENT_ID);
  const clientSecret = clean(process.env.EBAY_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error("eBay lookup credentials are not configured.");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok || !data.access_token) {
    throw new Error(clean(data.error_description || data.error) || `eBay OAuth failed (${response.status}).`);
  }
  tokenCache = { token: String(data.access_token), expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000 };
  return tokenCache.token;
}

async function ebayItem(url: URL) {
  const legacyId = ebayLegacyId(url);
  if (!legacyId) throw new Error("That eBay URL does not contain a usable item number.");
  const token = await ebayToken();
  const endpoint = new URL("https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id");
  endpoint.searchParams.set("legacy_item_id", legacyId);
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as EbayItem;
  if (!response.ok) {
    const error = data.errors?.[0];
    throw new Error(error?.longMessage || error?.message || `eBay item lookup failed (${response.status}).`);
  }
  return { data, legacyId };
}

function identityFromEbay(item: EbayItem) {
  const title = clean(item.title);
  const aspects = item.localizedAspects || [];
  const aspectPlayer = aspect(aspects, "Player/Athlete", "Player", "Athlete");
  const derived = deriveCardIdentity({ title, aspectPlayer });
  const features = aspect(aspects, "Features") || "";
  const parallel = aspect(aspects, "Parallel/Variety", "Parallel", "Variety") || (/\bbase\b/i.test(title) ? "Base" : "");
  const cardNumber = aspect(aspects, "Card Number", "Card No.", "Card #") || detectCardNumberFromTitle(title) || derived.cardNumber || "";
  const year = aspect(aspects, "Year Manufactured", "Season", "Year") || derived.year || "";
  return {
    player: aspectPlayer || derived.player || "",
    year,
    brand: aspect(aspects, "Manufacturer", "Brand") || "",
    setName: aspect(aspects, "Set") || "",
    cardNumber,
    parallel: parallel || "Base",
    serialNumber: aspect(aspects, "Print Run", "Serial Number", "Serial Numbered") || "",
    isAuto: yes(aspect(aspects, "Autographed")) || /\bauto(?:graph|graphed)?\b/i.test(title),
    isRelic: /\b(relic|patch|memorabilia|jersey)\b/i.test(`${title} ${features}`),
  };
}

export async function POST(request: Request) {
  try {
    const account = await requireSeller(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const rawUrl = clean(body.url);
    if (!rawUrl) return Response.json({ error: "Enter a purchase/item URL first." }, { status: 400 });
    const url = new URL(rawUrl);
    if (!/(^|\.)ebay\.com$/i.test(url.hostname)) {
      return Response.json({ error: "Automatic URL fill currently supports eBay item URLs. Card photos can still be auto-identified for any source." }, { status: 400 });
    }

    const legacyId = ebayLegacyId(url);
    if (!legacyId) {
      return Response.json({ error: "That eBay URL does not contain a usable item number." }, { status: 400 });
    }

    const syncedPurchase = await syncedPurchaseByEbayItemId(legacyId);
    if (syncedPurchase) {
      const identity = identityFromSyncedPurchase(syncedPurchase);
      const usable = Boolean(identity.player && identity.cardNumber);
      return Response.json({
        ok: true,
        source: clean(syncedPurchase.source) || "eBay",
        sourceItemId: clean(syncedPurchase.sourceItemId) || legacyId,
        seller: clean(syncedPurchase.seller) || null,
        title: clean(syncedPurchase.title) || null,
        totalCost: Number(syncedPurchase.allocatedCost) > 0 ? Number(syncedPurchase.allocatedCost) : null,
        purchaseDate: clean(syncedPurchase.purchaseDate) || null,
        orderNumber: clean(syncedPurchase.orderNumber || syncedPurchase.purchaseId) || null,
        identity,
        images: Array.isArray(syncedPurchase.imageUrls) ? syncedPurchase.imageUrls : [],
        usable,
        needsReview: !usable,
        resolvedFrom: "mac_local_synced_purchase",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data } = await ebayItem(url);
    const images = Array.from(new Set([
      data.image?.imageUrl,
      ...(data.additionalImages || []).map((row) => row.imageUrl),
    ].filter((value): value is string => Boolean(value))));
    const identity = identityFromEbay(data);
    const usable = Boolean(identity.player && identity.cardNumber);
    return Response.json({
      ok: true,
      source: "eBay",
      sourceItemId: data.legacyItemId || legacyId,
      seller: data.seller?.username || null,
      title: data.title || null,
      identity,
      images,
      usable,
      needsReview: !usable,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
