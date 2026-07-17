import { NextRequest, NextResponse } from "next/server";
import { sanitizeAuthenticityProfile } from "../../../../../../lib/authenticity";
import { createServerInventoryEngine } from "../../../../../../lib/server-inventory-engine";
import type { InventoryStatus } from "../../../../../../modules/inventory";

export const dynamic = "force-dynamic";

function parseString(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function parseNumber(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function redirectToProduct(
  request: NextRequest,
  id: number,
  params: Record<string, string>,
) {
  const url = new URL(`/admin/products/${id}`, request.url);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, { status: 303 });
}

function redirectToProducts(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/admin/products", request.url);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);

  if (!Number.isInteger(id) || id <= 0) {
    return redirectToProducts(request, {
      saveError: "Invalid product ID.",
    });
  }

  try {
    const formData = await request.formData();
    const status = String(formData.get("status") || "active") as InventoryStatus;
    const authenticity = sanitizeAuthenticityProfile({
      status: formData.get("authenticity_status"),
      autographSource: formData.get("autograph_source"),
      certProvider: formData.get("cert_provider"),
      certNumber: formData.get("cert_number"),
      guaranteedAuthenticators: formData.get("guaranteed_authenticators"),
      provenanceEvidence: formData.get("provenance_evidence"),
      authenticityNotes: formData.get("authenticity_notes"),
    });

    await createServerInventoryEngine().updateProduct(id, {
      title: String(formData.get("title") || "").trim(),
      player: parseString(formData.get("player")),
      sport: parseString(formData.get("sport")),
      price: parseNumber(formData.get("price")),
      quantity: Math.max(0, parseNumber(formData.get("quantity"))),
      status,
      imageUrl: parseString(formData.get("image_url")),
      description: parseString(formData.get("description")),
      authenticity,
    });

    return redirectToProduct(request, id, { saved: "1" });
  } catch (error: any) {
    return redirectToProduct(request, id, {
      saveError: error?.message || "Could not save product.",
    });
  }
}
