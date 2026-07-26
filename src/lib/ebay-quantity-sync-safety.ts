export function safeNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

export function selectLowestSafeEbayQuantity(values: unknown[]) {
  const candidates = values
    .map(safeNonNegativeInteger)
    .filter((value): value is number => value !== null);

  if (!candidates.length) {
    throw new Error("No safe local quantity was available for the eBay update.");
  }

  return Math.min(...candidates);
}

export function ebayQuantityRetryDelaySeconds(attemptCount: number) {
  const normalizedAttempt = Number.isFinite(attemptCount)
    ? Math.max(Math.floor(attemptCount), 0)
    : 0;
  const exponent = Math.min(normalizedAttempt, 5);
  return Math.min(15 * 60 * 2 ** exponent, 6 * 60 * 60);
}
