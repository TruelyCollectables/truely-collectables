import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import {
  updatePurchasePortfolioBucket,
  type PortfolioBucket,
} from "../../../../../../../lib/market-intel-purchase-intelligence";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const value = String(formData.get("portfolioBucket") ?? "").trim();
    if (!["resale", "hold", "pc"].includes(value)) {
      throw new Error("Choose Resale, Hold / Investment, or Personal Collection.");
    }

    await updatePurchasePortfolioBucket(id, value as PortfolioBucket);
    revalidatePath("/admin/market-intel/purchases");
    revalidatePath("/admin/market-intel/portfolio");
    revalidatePath(`/admin/market-intel/purchases/${id}`);

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/${id}?saved=strategy`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update purchase strategy.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/purchases/${id}?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
