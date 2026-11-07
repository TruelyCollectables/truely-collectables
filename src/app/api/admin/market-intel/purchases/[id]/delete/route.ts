import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { deleteDuplicateMarketIntelPurchase } from "../../../../../../../lib/market-intel-purchase-editor";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const confirmation = String(formData.get("confirmation") ?? "").trim();
    const duplicateConfirmed = formData.get("duplicateConfirmed") === "on";
    if (!duplicateConfirmed) {
      throw new Error("Confirm that this is an accidental duplicate before deleting it.");
    }

    const deleted = await deleteDuplicateMarketIntelPurchase(id, confirmation);

    revalidatePath("/admin/market-intel/purchases");
    revalidatePath("/admin/market-intel/portfolio");
    revalidatePath("/admin/market-intel/purchases/ebay-intake");

    const query = new URLSearchParams({
      number: String(deleted.purchaseNumber),
      collectible: deleted.collectibleName,
    });
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/deleted?${query.toString()}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete duplicate purchase.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/${id}/edit?error=${encodeURIComponent(message)}#delete-purchase`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
