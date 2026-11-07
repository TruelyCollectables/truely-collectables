export const EBAY_MERGED_LISTING_GROUPS = [
  {
    key: "2025-donruss-400-jaxson-dart",
    canonicalLegacyProductId: 1991,
    aliasItemIds: ["317570836168", "317570836334"],
  },
] as const;

const mergedAliasItemIds = new Set<string>(
  EBAY_MERGED_LISTING_GROUPS.flatMap((group) => [...group.aliasItemIds]),
);

const mergedCanonicalProductIds = new Set<number>(
  EBAY_MERGED_LISTING_GROUPS.map((group) => group.canonicalLegacyProductId),
);

export function isMergedEbayAliasItemId(value: unknown) {
  return mergedAliasItemIds.has(String(value || "").trim());
}

export function isMergedEbayCanonicalProductId(value: unknown) {
  return mergedCanonicalProductIds.has(Number(value));
}

export function canonicalLegacyProductIdForEbayItemId(value: unknown) {
  const itemId = String(value || "").trim();
  if (!itemId) return null;

  const group = EBAY_MERGED_LISTING_GROUPS.find((candidate) =>
    candidate.aliasItemIds.some((aliasItemId) => aliasItemId === itemId),
  );
  return group?.canonicalLegacyProductId ?? null;
}

export function isMergedEbayListingMember(input: {
  itemId: unknown;
  legacyProductId: unknown;
}) {
  return (
    isMergedEbayAliasItemId(input.itemId) ||
    isMergedEbayCanonicalProductId(input.legacyProductId)
  );
}
