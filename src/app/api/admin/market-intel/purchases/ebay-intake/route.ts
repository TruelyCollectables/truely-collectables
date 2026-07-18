import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import {
  EbayBuyerOrderError,
  fetchEbayBuyerOrder,
  parseEbayOrderId,
} from "../../../../../../lib/ebay-buyer-orders";
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
      throw new Error(
        "Enter an eBay order-details link, listing URL, order number, item number, or Browse item ID.",
      );
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

async function resolvePlayerName(
  ebayItem: string,
  manualPlayerName: string,
  fallbackTitle?: string,
) {
  if (manualPlayerName.trim()) return manualPlayerName.trim();

  let detail: EbayItemDetail;
  try {
    detail = await fetchEbayItemForPlayer(ebayItem);
  } catch (error) {
    if (!fallbackTitle) throw error;
    detail = { title: fallbackTitle, localizedAspects: [] };
  }

  const aspectPlayer = aspectValue(detail.localizedAspects, [
    "Player/Athlete",
    "Player",
    "Athlete",
    "Featured Person/Artist",
  ]);
  if (aspectPlayer) return aspectPlayer;

  const watchlistPlayer = await playerFromWatchlistTitle(detail.title || fallbackTitle);
  if (watchlistPlayer) return watchlistPlayer;

  return "Needs Player Review";
}

function intakeRedirect(
  request: NextRequest,
  handoff: string | null,
  params: Record<string, string>,
) {
  const query = new URLSearchParams(params);
  return NextResponse.redirect(
    adminRedirectUrl(
      `/admin/market-intel/purchases/ebay-intake?${query.toString()}`,
      request.url,
      handoff,
    ),
    303,
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
      const manualPlayerName = text(formData, "playerName");
      const sportOrCategory = text(formData, "sportOrCategory") || "Baseball";
      const bucket: PurchaseInboxBucket = ["resale", "hold", "skip"].includes(targetBucket)
        ? targetBucket
        : "resale";
      const orderId = parseEbayOrderId(ebayItem);

      if (orderId) {
        const order = await fetchEbayBuyerOrder(ebayItem);
        const purchaseDate = order.purchaseDate.slice(0, 10);
        let added = 0;

        for (const line of order.lines) {
          const playerName = await resolvePlayerName(
            line.itemId,
            order.lines.length === 1 ? manualPlayerName : "",
            line.title,
          );
          await stageEbayPurchase({
            ebayItem: line.itemId,
            playerName,
            sportOrCategory,
            purchaseDate,
            quantity: line.quantity,
            itemSubtotal: line.itemSubtotal,
            inboundShipping: line.inboundShipping,
            salesTax: line.salesTax,
            buyerFees: line.buyerFees,
            otherCost: line.otherCost,
            targetBucket: bucket,
            externalOrderId: order.orderId,
          });
          added += 1;
        }

        revalidatePath("/admin/market-intel/purchases/ebay-intake");
        return intakeRedirect(request, handoff, {
          added: String(added),
          order: order.orderId,
        });
      }

      const playerName = await resolvePlayerName(ebayItem, manualPlayerName);
      await stageEbayPurchase({
        ebayItem,
        playerName,
        sportOrCategory,
        purchaseDate: text(formData, "purchaseDate"),
        quantity: Math.max(1, Math.round(numberField(formData, "quantity", 1))),
        itemSubtotal: numberField(formData, "itemSubtotal", 0),
        inboundShipping: numberField(formData, "inboundShipping", 0),
        salesTax: numberField(formData, "salesTax", 0),
        buyerFees: numberField(formData, "buyerFees", 0),
        otherCost: numberField(formData, "otherCost", 0),
        targetBucket: bucket,
        externalOrderId: text(formData, "externalOrderId") || null,
      });
      revalidatePath("/admin/market-intel/purchases/ebay-intake");
      return intakeRedirect(request, handoff, { added: "1" });
    }

    const inboxIds = formData.getAll("inboxIds").map((value) => String(value));
    if (inboxIds.length === 0) {
      throw new Error("Select at least one Purchase Inbox row.");
    }

    if (action === "skip") {
      const result = await skipPurchaseInboxRows(inboxIds);
      revalidatePath("/admin/market-intel/purchases/ebay-intake");
      return intakeRedirect(request, handoff, { skipped: String(result.skipped) });
    }

    const bucket = action === "move_hold" ? "hold" : action === "move_resale" ? "resale" : null;
    if (!bucket) throw new Error("Unsupported Purchase Inbox action.");
    const result = await movePurchaseInboxToReview(inboxIds, bucket);
    revalidatePath("/admin/market-intel/purchases/ebay-intake");
    revalidatePath("/admin/market-intel/discovery");
    const params: Record<string, string> = { moved: String(result.moved) };
    if (result.errors[0]) params.error = result.errors[0].slice(0, 240);
    return intakeRedirect(request, handoff, params);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process eBay purchase intake.";
    revalidatePath("/admin/market-intel/purchases/ebay-intake");
    return intakeRedirect(request, handoff, {
      error: message,
      ...(error instanceof EbayBuyerOrderError && error.code === "RECONNECT_REQUIRED"
        ? { reconnect: "1" }
        : {}),
    });
  }
}
