import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import {
  updateMarketIntelPurchase,
  type EditableAcquisitionChannel,
} from "../../../../../../../lib/market-intel-purchase-editor";
import type { PortfolioBucket } from "../../../../../../../lib/market-intel-purchase-intelligence";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function numberField(formData: FormData, name: string, fallback = 0) {
  const raw = text(formData, name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const bucketValue = text(formData, "portfolioBucket");
    const portfolioBucket: PortfolioBucket = ["resale", "hold", "pc"].includes(
      bucketValue,
    )
      ? (bucketValue as PortfolioBucket)
      : "resale";
    const channelValue = text(formData, "acquisitionChannel");
    const acquisitionChannel: EditableAcquisitionChannel = [
      "ebay",
      "marketplace",
      "card_show",
      "card_shop",
      "private_deal",
      "trade",
      "other",
    ].includes(channelValue)
      ? (channelValue as EditableAcquisitionChannel)
      : "other";
    const pricingMode =
      text(formData, "pricingMode") === "per_item" ? "per_item" : "lot_total";

    await updateMarketIntelPurchase(id, {
      purchaseDate: text(formData, "purchaseDate"),
      portfolioBucket,
      acquisitionChannel,
      sourceName: text(formData, "sourceName"),
      sourceLocation: text(formData, "sourceLocation"),
      externalOrderId: text(formData, "externalOrderId"),
      sourceUrl: text(formData, "sourceUrl"),
      notes: text(formData, "notes"),
      alreadyReceived: formData.get("alreadyReceived") === "on",
      pricingMode,
      quantity: Math.round(numberField(formData, "quantity", 1)),
      itemSubtotal: numberField(formData, "itemSubtotal", 0),
      inboundShipping: numberField(formData, "inboundShipping", 0),
      salesTax: numberField(formData, "salesTax", 0),
      buyerFees: numberField(formData, "buyerFees", 0),
      otherCost: numberField(formData, "otherCost", 0),
    });

    revalidatePath("/admin/market-intel/purchases");
    revalidatePath(`/admin/market-intel/purchases/${id}`);
    revalidatePath(`/admin/market-intel/purchases/${id}/edit`);
    revalidatePath("/admin/market-intel/portfolio");

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/${id}/edit?saved=corrected`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to correct purchase.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/${id}/edit?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
