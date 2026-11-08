export type EbayDuplicateSelectionRow = {
  productId: number;
};

export type EbayDuplicateSelectionGroup = {
  key: string;
  recommendedKeeperProductId: number | null;
  rows: EbayDuplicateSelectionRow[];
};

function positiveProductId(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function reconcileEbayDuplicateKeeperSelection(
  groups: EbayDuplicateSelectionGroup[],
  current: Record<string, number>,
) {
  const next: Record<string, number> = {};

  for (const group of groups) {
    const rowIds = new Set(group.rows.map((row) => positiveProductId(row.productId)));
    const currentKeeperId = positiveProductId(current[group.key]);
    const recommendedKeeperId = positiveProductId(group.recommendedKeeperProductId);
    const fallbackKeeperId = positiveProductId(group.rows[0]?.productId);

    if (currentKeeperId && rowIds.has(currentKeeperId)) {
      next[group.key] = currentKeeperId;
    } else if (recommendedKeeperId && rowIds.has(recommendedKeeperId)) {
      next[group.key] = recommendedKeeperId;
    } else if (fallbackKeeperId) {
      next[group.key] = fallbackKeeperId;
    }
  }

  return next;
}

export function reconcileEbayDuplicateRowSelection(
  groups: EbayDuplicateSelectionGroup[],
  current: Record<string, number>,
  keepers: Record<string, number>,
) {
  const next: Record<string, number> = {};

  for (const group of groups) {
    const keeperId =
      positiveProductId(keepers[group.key]) ||
      positiveProductId(group.recommendedKeeperProductId) ||
      positiveProductId(group.rows[0]?.productId);
    const currentDuplicateId = positiveProductId(current[group.key]);
    const currentDuplicateStillValid = group.rows.some(
      (row) =>
        positiveProductId(row.productId) === currentDuplicateId &&
        positiveProductId(row.productId) !== keeperId,
    );
    const duplicate = currentDuplicateStillValid
      ? group.rows.find((row) => positiveProductId(row.productId) === currentDuplicateId)
      : group.rows.find((row) => positiveProductId(row.productId) !== keeperId);
    const duplicateId = positiveProductId(duplicate?.productId);

    if (duplicateId) {
      next[group.key] = duplicateId;
    }
  }

  return next;
}
