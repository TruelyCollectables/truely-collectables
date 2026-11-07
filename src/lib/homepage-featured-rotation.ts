type HomepageInventoryItem = {
  legacyProductId: number;
  quantity: number;
};

const HOMEPAGE_ROTATION_INTERVAL_MS = 15 * 60 * 1000;

function hash(value: string) {
  let output = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }

  return output >>> 0;
}

export function selectRotatingAvailableHomepageItems<
  T extends HomepageInventoryItem,
>(
  items: T[],
  options: {
    count?: number;
    now?: Date;
  } = {},
) {
  const count = Math.max(0, Math.floor(options.count ?? 8));
  const bucket = Math.floor(
    (options.now || new Date()).getTime() / HOMEPAGE_ROTATION_INTERVAL_MS,
  );

  return items
    .filter(
      (item) =>
        Number.isInteger(Number(item.legacyProductId)) &&
        Number(item.legacyProductId) > 0 &&
        Number(item.quantity) > 0,
    )
    .slice()
    .sort((left, right) => {
      const leftRank = hash(`${bucket}:${left.legacyProductId}`);
      const rightRank = hash(`${bucket}:${right.legacyProductId}`);

      return leftRank - rightRank || left.legacyProductId - right.legacyProductId;
    })
    .slice(0, count);
}
