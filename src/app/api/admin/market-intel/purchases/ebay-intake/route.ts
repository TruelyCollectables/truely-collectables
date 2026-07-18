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

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const formData = await request.formData();
    const action = text(formData, "action");

    if (action === "add") {
      const targetBucket = text(formData, "targetBucket") as PurchaseInboxBucket;
      await stageEbayPurchase({
        ebayItem: text(formData, "ebayItem"),
        playerName: text(formData, "playerName"),
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
