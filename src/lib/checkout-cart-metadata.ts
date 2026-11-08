export const STRIPE_CART_METADATA_MAX_LENGTH = 450;

type CartMetadataItem = {
  id: number;
  quantity: number;
};

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function encodeCartMetadata(cart: CartMetadataItem[]) {
  return cart.map((item) => `${item.id}:${item.quantity}`).join(",");
}

function parseCompactCartMetadata(value: string): CartMetadataItem[] {
  if (!value.trim()) return [];

  return value.split(",").map((entry) => {
    const [idValue, quantityValue] = entry.split(":");
    const id = positiveInteger(idValue);
    const quantity = positiveInteger(quantityValue || 1);

    if (!id || !quantity) {
      return { id: 0, quantity: 0 };
    }

    return { id, quantity };
  });
}

export function parseCartMetadata(value: string | null | undefined): CartMetadataItem[] {
  const metadata = String(value || "").trim();

  if (!metadata) return [];

  if (metadata.startsWith("[") || metadata.startsWith("{")) {
    try {
      const parsed = JSON.parse(metadata);
      const rawItems = Array.isArray(parsed) ? parsed : parsed.items;

      if (!Array.isArray(rawItems)) return [];

      return rawItems.map((item) => ({
        id: positiveInteger(item?.id ?? item?.product_id ?? item?.productId) ?? 0,
        quantity: positiveInteger(item?.quantity ?? item?.qty ?? 1) ?? 0,
      }));
    } catch {
      return [];
    }
  }

  return parseCompactCartMetadata(metadata);
}
