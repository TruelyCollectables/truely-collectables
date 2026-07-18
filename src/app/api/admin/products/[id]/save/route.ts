import { NextRequest, NextResponse } from "next/server";
import { sanitizeAuthenticityProfile } from "../../../../../../lib/authenticity";
import { createServerInventoryEngine } from "../../../../../../lib/server-inventory-engine";
import type { InventoryStatus } from "../../../../../../modules/inventory";

export const dynamic = "force-dynamic";

const INVENTORY_STATUSES: InventoryStatus[] = [
  "draft",
  "active",
  "reserved",
  "sold",
  "archived",
];

function parseString(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function parsePositiveMoney(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? "");

  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function parseWholeQuantity(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? "");

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseStatus(value: FormDataEntryValue | null) {
  const status = String(value || "active") as InventoryStatus;

  return INVENTORY_STATUSES.includes(status) ? status : null;
}

function parseImageUrl(value: FormDataEntryValue | null) {
  const text = parseString(value);

  if (!text) return null;

  try {
    const url = new URL(text);

    return url.protocol === "http:" || url.protocol === "https:" ? text : false;
  } catch {
    return false;
  }
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
    const title = parseString(formData.get("title"));
    const status = parseStatus(formData.get("status"));
    const price = parsePositiveMoney(formData.get("price"));
    const quantity = parseWholeQuantity(formData.get("quantity"));
    const imageUrl = parseImageUrl(formData.get("image_url"));
    const authenticity = sanitizeAuthenticityProfile({
      status: formData.get("authenticity_status"),
      autographSource: formData.get("autograph_source"),
      certProvider: formData.get("cert_provider"),
      certNumber: formData.get("cert_number"),
      guaranteedAuthenticators: formData.get("guaranteed_authenticators"),
      provenanceEvidence: formData.get("provenance_evidence"),
      authenticityNotes: formData.get("authenticity_notes"),
    });

    if (!title) {
      return redirectToProduct(request, id, { saveError: "Title is required." });
    }

    if (price === null) {
      return redirectToProduct(request, id, {
        saveError: "Price must be greater than zero.",
      });
    }

    if (quantity === null) {
      return redirectToProduct(request, id, {
        saveError: "Quantity must be a whole number of zero or more.",
      });
    }

    if (!status) {
      return redirectToProduct(request, id, {
        saveError: "Unsupported inventory status.",
      });
    }

    if (imageUrl === false) {
      return redirectToProduct(request, id, {
        saveError: "Image URL must begin with http:// or https://.",
      });
    }

    await createServerInventoryEngine().updateProduct(id, {
      title,
      player: parseString(formData.get("player")),
      sport: parseString(formData.get("sport")),
      price,
      quantity,
      status,
      imageUrl,
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
