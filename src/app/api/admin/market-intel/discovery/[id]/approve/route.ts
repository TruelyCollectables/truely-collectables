import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { approveIdentityCandidate } from "../../../../../../../lib/market-intel-identity-candidates";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalInteger(formData: FormData, name: string) {
  const value = text(formData, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
  return parsed;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const formData = await request.formData();
    const conditionType = text(formData, "conditionType") === "graded" ? "graded" : "raw";
    const result = await approveIdentityCandidate({
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
    });
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?approved=1&identityId=${encodeURIComponent(result.identityId)}${result.listingId ? `&listingId=${encodeURIComponent(result.listingId)}` : ""}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to approve candidate.";
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
