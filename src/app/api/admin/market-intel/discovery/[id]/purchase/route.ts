import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import type { CandidateApprovalInput } from "../../../../../../../lib/market-intel-identity-candidates";
import { recordDiscoveryCandidatePurchase } from "../../../../../../../lib/market-intel-discovery-purchases";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
  const value = text(formData, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
  return parsed;
}

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const json = wantsJson(request);
  try {
    const formData = await request.formData();
    const conditionType: CandidateApprovalInput["conditionType"] =
      text(formData, "conditionType") === "graded" ? "graded" : "raw";
    const totalAcquisitionCost = numberField(
      formData,
      "totalAcquisitionCost",
      0,
    );
    const purchase = await recordDiscoveryCandidatePurchase({
      candidateId: id,
      seasonYear: text(formData, "seasonYear"),
      manufacturer: text(formData, "manufacturer"),
      brand: text(formData, "brand"),
      productLine: text(formData, "productLine"),
      setName: text(formData, "setName"),
      insertName: text(formData, "insertName"),
      cardNumber: text(formData, "cardNumber"),
      parallelName: text(formData, "parallelName"),
      variationName: text(formData, "variationName"),
      serialNumberedTo: optionalInteger(formData, "serialNumberedTo"),
      autograph: formData.get("autograph") === "on",
      memorabilia: formData.get("memorabilia") === "on",
      rookieDesignation: formData.get("rookieDesignation") === "on",
      conditionType,
      gradingCompany: text(formData, "gradingCompany"),
      grade: text(formData, "grade"),
      quantity: Number(text(formData, "quantity") || 1),
      itemSubtotal: numberField(
        formData,
        "itemSubtotal",
        totalAcquisitionCost,
      ),
      inboundShipping: numberField(formData, "inboundShipping", 0),
      salesTax: numberField(formData, "salesTax", 0),
      totalAcquisitionCost,
      purchaseDate: text(formData, "purchaseDate") || null,
      alreadyReceived: formData.get("alreadyReceived") === "on",
    });

    revalidatePath("/admin/market-intel/discovery");
    revalidatePath("/admin/market-intel/purchases");
    revalidatePath(`/admin/market-intel/purchases/${purchase.purchaseId}`);

    const redirectUrl = adminRedirectUrl(
      `/admin/market-intel/purchases/${purchase.purchaseId}?saved=purchased`,
      request.url,
      handoff,
    );

    if (json) {
      return NextResponse.json(
        {
          success: true,
          purchaseId: purchase.purchaseId,
          purchaseNumber: purchase.purchaseNumber,
          alreadyRecorded: purchase.alreadyRecorded,
          redirectUrl: redirectUrl.toString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record Discovery purchase.";
    revalidatePath("/admin/market-intel/discovery");

    if (json) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?error=${encodeURIComponent(message)}#candidate-${encodeURIComponent(id)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
