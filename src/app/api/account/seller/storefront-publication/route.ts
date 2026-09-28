import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import {
  ensureStorefrontProduct,
  findStorefrontProductsBySku,
  getStorefrontProduct,
  publishStorefrontProduct,
  updateStorefrontProduct,
  verifyStorefrontProduct,
} from "../../../../../lib/storefront-publication-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = record(await request.json().catch(() => ({})));
  const action = String(body.action || "").trim();
  const payload = record(body.payload);

  try {
    let result: unknown;
    switch (action) {
      case "find_by_sku":
        result = await findStorefrontProductsBySku(
          String(payload.sku || ""),
          Number(payload.limit || 2),
        );
        break;
      case "get":
        result = await getStorefrontProduct(Number(payload.productId || 0));
        break;
      case "ensure":
        result = await ensureStorefrontProduct(payload as never);
        break;
      case "update":
        result = await updateStorefrontProduct(
          Number(payload.productId || 0),
          record(payload.patch),
        );
        break;
      case "publish":
        result = await publishStorefrontProduct(payload as never);
        break;
      case "verify":
        result = await verifyStorefrontProduct(payload as never);
        break;
      default:
        return Response.json(
          { error: "Unknown storefront publication action." },
          { status: 400 },
        );
    }
    return Response.json(
      { ok: true, result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const typed = error as Error & {
      code?: string;
      productIds?: number[];
    };
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Storefront publication subsystem failed.",
        code: typed.code || null,
        productIds: Array.isArray(typed.productIds) ? typed.productIds : [],
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
