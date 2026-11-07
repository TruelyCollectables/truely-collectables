export type StorefrontProductRow = {
  id: number;
  sku: string | null;
  title: string | null;
  player: string | null;
  sport?: string | null;
  description?: string | null;
  price: number | null;
  quantity: number | null;
  image_url: string | null;
  listing_status: string | null;
  archived_at: string | null;
  ebay_item_id?: string | null;
};

type JsonRecord = Record<string, unknown>;
type StorefrontAction =
  | "find_by_sku"
  | "get"
  | "ensure"
  | "update"
  | "publish"
  | "verify";

async function callStorefront<T>(
  request: Request,
  action: StorefrontAction,
  payload: JsonRecord,
): Promise<T> {
  const url = new URL("/api/account/seller/storefront-publication", request.url);
  const headers = new Headers({ "content-type": "application/json" });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, payload }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok || body.ok !== true) {
    const error = new Error(
      String(body.error || `Storefront publication failed (${response.status}).`),
    ) as Error & { code?: string; productIds?: number[] };
    if (typeof body.code === "string" && body.code) error.code = body.code;
    if (Array.isArray(body.productIds)) {
      error.productIds = body.productIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    }
    throw error;
  }
  return body.result as T;
}

export function findStorefrontProductsBySku(
  request: Request,
  sku: string,
  limit = 2,
) {
  return callStorefront<StorefrontProductRow[]>(request, "find_by_sku", {
    sku,
    limit,
  });
}

export function getStorefrontProduct(request: Request, productId: number) {
  return callStorefront<StorefrontProductRow | null>(request, "get", {
    productId,
  });
}

export function ensureStorefrontProduct(
  request: Request,
  input: JsonRecord,
) {
  return callStorefront<StorefrontProductRow>(request, "ensure", input);
}

export function updateStorefrontProduct(
  request: Request,
  productId: number,
  patch: JsonRecord,
) {
  return callStorefront<StorefrontProductRow>(request, "update", {
    productId,
    patch,
  });
}

export function publishStorefrontProduct(
  request: Request,
  input: JsonRecord,
) {
  return callStorefront<StorefrontProductRow>(request, "publish", input);
}

export type StorefrontVerification = {
  verified: boolean;
  checkedAt: string;
  failed: string[];
  source?: string;
  productId?: number;
  checks?: JsonRecord;
  product?: StorefrontProductRow | null;
};

export function verifyStorefrontProduct(
  request: Request,
  input: JsonRecord,
) {
  return callStorefront<StorefrontVerification>(request, "verify", input);
}
