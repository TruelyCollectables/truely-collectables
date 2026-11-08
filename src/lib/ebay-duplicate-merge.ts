export type EbayDuplicateQuantityRow = {
  productId: number | string | null | undefined;
  quantity: number | string | null | undefined;
};

function positiveInteger(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function normalizeEbayDuplicateProductIds(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const ids = values
    .map((entry) => positiveInteger(entry))
    .filter((entry) => entry > 0);

  return Array.from(new Set(ids));
}

export function planEbayDuplicateQuantityMerge(params: {
  keeperProductId: number;
  keeperQuantity: unknown;
  duplicateRows: EbayDuplicateQuantityRow[];
}) {
  const keeperProductId = positiveInteger(params.keeperProductId);

  if (!keeperProductId) {
    throw new Error("Keeper product ID is required.");
  }

  const seenDuplicateIds = new Set<number>();
  const duplicateRows = params.duplicateRows.filter((row) => {
    const productId = positiveInteger(row.productId);

    if (!productId || productId === keeperProductId || seenDuplicateIds.has(productId)) {
      return false;
    }

    seenDuplicateIds.add(productId);
    return true;
  });

  if (!duplicateRows.length) {
    throw new Error("Pick at least one duplicate row different from the keeper.");
  }

  const previousKeeperQuantity = wholeQuantity(params.keeperQuantity);
  const duplicateQuantity = duplicateRows.reduce(
    (sum, row) => sum + wholeQuantity(row.quantity),
    0,
  );

  return {
    keeperProductId,
    duplicateProductIds: duplicateRows.map((row) => positiveInteger(row.productId)),
    previousKeeperQuantity,
    duplicateQuantity,
    mergedQuantity: previousKeeperQuantity + duplicateQuantity,
    archivedDuplicateCount: duplicateRows.length,
  };
}
