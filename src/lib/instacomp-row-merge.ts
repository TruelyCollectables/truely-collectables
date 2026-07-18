export type InstaCompQuantityMergeRow = {
  id: string;
  title: string;
  quantity: number | string | null | undefined;
};

export type InstaCompQuantityMergePlan =
  | {
      ok: true;
      keeperId: string;
      duplicateIds: string[];
      title: string;
      previousKeeperQuantity: number;
      duplicateQuantity: number;
      mergedQuantity: number;
      mergedRowCount: number;
    }
  | {
      ok: false;
      reason: string;
    };

export function normalizedInstaCompMergeTitle(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function normalizedInstaCompMergeQuantity(
  value: number | string | null | undefined,
) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 1;

  return Math.max(1, Math.floor(parsed));
}

export function planInstaCompSelectedQuantityMerge(
  rows: InstaCompQuantityMergeRow[],
): InstaCompQuantityMergePlan {
  if (rows.length < 2) {
    return {
      ok: false,
      reason: "Select at least two duplicate InstaComp™ rows before merging quantities.",
    };
  }

  const [keeper, ...duplicates] = rows;
  const keeperTitle = normalizedInstaCompMergeTitle(keeper.title);

  if (!keeperTitle) {
    return {
      ok: false,
      reason: "The keeper row needs a title before quantities can be merged.",
    };
  }

  const mismatched = duplicates.find(
    (row) => normalizedInstaCompMergeTitle(row.title) !== keeperTitle,
  );

  if (mismatched) {
    return {
      ok: false,
      reason:
        "Selected rows must have the same edited title before merging. Fix the titles first so different cards are not combined.",
    };
  }

  const previousKeeperQuantity = normalizedInstaCompMergeQuantity(keeper.quantity);
  const duplicateQuantity = duplicates.reduce(
    (total, row) => total + normalizedInstaCompMergeQuantity(row.quantity),
    0,
  );

  return {
    ok: true,
    keeperId: keeper.id,
    duplicateIds: duplicates.map((row) => row.id),
    title: keeper.title.trim(),
    previousKeeperQuantity,
    duplicateQuantity,
    mergedQuantity: previousKeeperQuantity + duplicateQuantity,
    mergedRowCount: rows.length,
  };
}
