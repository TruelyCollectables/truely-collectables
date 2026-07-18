export type InstaCompQuantityMergeRow = {
  id: string;
  title: string;
  identityKey?: string | null;
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
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function normalizedInstaCompMergeIdentityKey(
  value: string | null | undefined,
) {
  return normalizedInstaCompMergeTitle(value);
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
  const identityKeys = rows.map((row) =>
    normalizedInstaCompMergeIdentityKey(row.identityKey),
  );
  const everyRowHasIdentityKey = identityKeys.every(Boolean);

  if (everyRowHasIdentityKey) {
    const keeperIdentityKey = identityKeys[0];
    const mismatchedByIdentity = identityKeys.find(
      (identityKey) => identityKey !== keeperIdentityKey,
    );

    if (mismatchedByIdentity) {
      return {
        ok: false,
        reason:
          "Selected rows must identify the same scanned card before merging quantities. Different card identities were selected.",
      };
    }

    const previousKeeperQuantity = normalizedInstaCompMergeQuantity(
      keeper.quantity,
    );
    const duplicateQuantity = duplicates.reduce(
      (total, row) => total + normalizedInstaCompMergeQuantity(row.quantity),
      0,
    );

    return {
      ok: true,
      keeperId: keeper.id,
      duplicateIds: duplicates.map((row) => row.id),
      title: keeper.title.trim() || "matched scanned card",
      previousKeeperQuantity,
      duplicateQuantity,
      mergedQuantity: previousKeeperQuantity + duplicateQuantity,
      mergedRowCount: rows.length,
    };
  }

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
