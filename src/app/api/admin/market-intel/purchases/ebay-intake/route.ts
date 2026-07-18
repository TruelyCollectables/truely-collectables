import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import {
  movePurchaseInboxToReview,
  skipPurchaseInboxRows,
  stageEbayPurchase,
  type PurchaseInboxBucket,
} from "../../../../../../lib/market-intel-ebay-purchase-inbox";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

type EbayAspect = { name?: string; value?: string };
type EbayItemDetail = {
  title?: string;
  localizedAspects?: EbayAspect[];
  errors?: Array<{ message?: string; longMessage?: string }>;
};

let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function numberField(formData: FormData, name: string, fallback = 0) {
  const raw = text(formData, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function legacyItemId(value: string) {
  const trimmed = value.trim();
  if (/^\d{9,15}$/.test(trimmed)) return trimmed;
  return (
    trimmed.match(/(?:\/itm\/(?:[^/]+\/)?|[?&]item=)(\d{9,15})(?:\D|$)/i)?.[1] ||
    null
  );
}

async function getEbayToken() {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) {
    return ebayTokenCache.token;
  }

  const credentials = Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
  ).toString("base64");
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
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || `eBay OAuth failed (${response.status}).`,
    );
  }

  ebayTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000,
  };
  return ebayTokenCache.token;
}

async function fetchEbayItemForPlayer(ebayItem: string) {
  const value = ebayItem.trim();
  if (!value) throw new Error("Paste an eBay item URL or item number.");

  let url: URL;
  if (value.startsWith("v1|")) {
    url = new URL(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(value)}`);
  } else {
    const legacy = legacyItemId(value);
    if (!legacy) {
      throw new Error("Enter a valid eBay item URL, legacy item number, or Browse item ID.");
    }
    url = new URL("https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id");
    url.searchParams.set("legacy_item_id", legacy);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await getEbayToken()}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as EbayItemDetail;

  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage || error?.message || `eBay item lookup failed (${response.status}).`,
    );
  }

  return payload;
}

function aspectValue(aspects: EbayAspect[] | undefined, names: string[]) {
  const accepted = names.map(normalize);
  for (const aspect of aspects || []) {
    if (!accepted.includes(normalize(aspect.name))) continue;
    const value = String(aspect.value || "").trim();
    if (value) return value;
  }
  return null;
}

async function playerFromWatchlistTitle(title: string | undefined) {
  const normalizedTitle = ` ${normalize(title)} `;
  if (!normalizedTitle.trim()) return null;

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_subjects")
    .select("name")
    .eq("subject_type", "player")
    .eq("active", true)
    .limit(1000);
  if (error) throw new Error(error.message);

  const matches = (data || [])
    .map((row) => String(row.name || "").trim())
    .filter(Boolean)
    .sort((left, right) => normalize(right).length - normalize(left).length);

  return (
    matches.find((name) => {
      const normalizedName = normalize(name);
      return normalizedName && normalizedTitle.includes(` ${normalizedName} `);
    }) || null
  );
}

async function resolvePlayerName(ebayItem: string, manualPlayerName: string) {
  if (manualPlayerName.trim()) return manualPlayerName.trim();

  const detail = await fetchEbayItemForPlayer(ebayItem);
  const aspectPlayer = aspectValue(detail.localizedAspects, [
    "Player/Athlete",
    "Player",
    "Athlete",
    "Featured Person/Artist",
  ]);
  if (aspectPlayer) return aspectPlayer;

  const watchlistPlayer = await playerFromWatchlistTitle(detail.title);
  if (watchlistPlayer) return watchlistPlayer;

  throw new Error(
    "TCOS could not identify the player from this eBay listing. Enter the player correction once and submit again.",
  );
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const formData = await request.formData();
    const action = text(formData, "action");

    if (action === "add") {
      const targetBucket = text(formData, "targetBucket") as PurchaseInboxBucket;
      const ebayItem = text(formData, "ebayItem");
      const playerName = await resolvePlayerName(ebayItem, text(formData, "playerName"));

      await stageEbayPurchase({
        ebayItem,
        playerName,
        sportOrCategory: text(formData, "sportOrCategory") || "Baseball",
        purchaseDate: text(formData, "purchaseDate"),
        quantity: Math.max(1, Math.round(numberField(formData, "quantity", 1))),
        itemSubtotal: numberField(formData, "itemSubtotal", 0),
        inboundShipping: numberField(formData, "inboundShipping", 0),
        salesTax: numberField(formData, "salesTax", 0),
        buyerFees: numberField(formData, "buyerFees", 0),
        otherCost: numberField(formData, "otherCost", 0),
        targetBucket: ["resale", "hold", "skip"].includes(targetBucket)
          ? targetBucket
          : "resale",
        externalOrderId: text(formData, "externalOrderId") || null,
      });
      revalidatePath("/admin/market-intel/purchases/ebay-intake");
      return NextResponse.redirect(
        adminRedirectUrl(
          "/admin/market-intel/purchases/ebay-intake?added=1",
          request.url,
          handoff,
        ),
        303,
      );
    }

    const inboxIds = formData.getAll("inboxIds").map((value) => String(value));
    if (inboxIds.length === 0) {
      throw new Error("Select at least one Purchase Inbox row.");
    }

    if (action === "skip") {
      const result = await skipPurchaseInboxRows(inboxIds);
      revalidatePath("/admin/market-intel/purchases/ebay-intake");
      return NextResponse.redirect(
        adminRedirectUrl(
          `/admin/market-intel/purchases/ebay-intake?skipped=${result.skipped}`,
          request.url,
          handoff,
        ),
        303,
      );
    }

    const bucket = action === "move_hold" ? "hold" : action === "move_resale" ? "resale" : null;
    if (!bucket) throw new Error("Unsupported Purchase Inbox action.");
    const result = await movePurchaseInboxToReview(inboxIds, bucket);
    revalidatePath("/admin/market-intel/purchases/ebay-intake");
    revalidatePath("/admin/market-intel/discovery");
    const error = result.errors[0] || "";
    const params = new URLSearchParams({ moved: String(result.moved) });
    if (error) params.set("error", error.slice(0, 240));
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/ebay-intake?${params.toString()}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process eBay purchase intake.";
    revalidatePath("/admin/market-intel/purchases/ebay-intake");
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/ebay-intake?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
