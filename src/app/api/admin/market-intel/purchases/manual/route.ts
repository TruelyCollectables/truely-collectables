import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import {
  createManualMarketIntelPurchase,
  type OfflineAcquisitionChannel,
} from "../../../../../../lib/market-intel-manual-purchases";
import type { PortfolioBucket } from "../../../../../../lib/market-intel-purchase-intelligence";

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

function optionalInteger(formData: FormData, name: string) {
  const raw = text(formData, name);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
  return parsed;
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const channelValue = text(formData, "acquisitionChannel");
    const acquisitionChannel: OfflineAcquisitionChannel = [
      "card_show",
      "card_shop",
      "private_deal",
      "trade",
      "other",
    ].includes(channelValue)
      ? (channelValue as OfflineAcquisitionChannel)
      : "other";
    const bucketValue = text(formData, "portfolioBucket");
    const portfolioBucket: PortfolioBucket = ["resale", "hold", "pc"].includes(
      bucketValue,
    )
      ? (bucketValue as PortfolioBucket)
      : "resale";

    const purchase = await createManualMarketIntelPurchase({
      acquisitionChannel,
      sourceName: text(formData, "sourceName"),
      sourceLocation: text(formData, "sourceLocation"),
      purchaseDate: text(formData, "purchaseDate"),
      portfolioBucket,
      alreadyReceived: formData.get("alreadyReceived") === "on",
      playerName: text(formData, "playerName"),
      sportOrCategory: text(formData, "sportOrCategory") || "Baseball",
      seasonYear: text(formData, "seasonYear"),
      manufacturer: text(formData, "manufacturer"),
      brand: text(formData, "brand"),
      productLine: text(formData, "productLine"),
      setName: text(formData, "setName"),
      insertName: text(formData, "insertName"),
      cardNumber: text(formData, "cardNumber"),
      parallelName: text(formData, "parallelName") || "Base",
      variationName: text(formData, "variationName"),
      serialNumberedTo: optionalInteger(formData, "serialNumberedTo"),
      autograph: formData.get("autograph") === "on",
      memorabilia: formData.get("memorabilia") === "on",
      rookieDesignation: formData.get("rookieDesignation") === "on",
      conditionType: text(formData, "conditionType") || "raw",
      gradingCompany: text(formData, "gradingCompany"),
      grade: text(formData, "grade"),
      quantity: Math.max(1, Math.round(numberField(formData, "quantity", 1))),
      itemSubtotal: numberField(formData, "itemSubtotal", 0),
      inboundShipping: numberField(formData, "inboundShipping", 0),
      salesTax: numberField(formData, "salesTax", 0),
      buyerFees: numberField(formData, "buyerFees", 0),
      otherCost: numberField(formData, "otherCost", 0),
      notes: text(formData, "notes"),
    });

    revalidatePath("/admin/market-intel/purchases");
    revalidatePath("/admin/market-intel/portfolio");
    revalidatePath(`/admin/market-intel/purchases/${purchase.purchaseId}`);

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/${purchase.purchaseId}?saved=created`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create offline purchase.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/new?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
