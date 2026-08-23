function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function instaCompPricingGroupKey(metadata: unknown) {
  const instaComp = record(record(metadata).instacomp);
  const checklistIdentity = record(instaComp.checklistIdentity);
  const channelDraft = record(instaComp.channelDraft);
  return (
    text(checklistIdentity.registryFingerprintSha256) ||
    text(channelDraft.registryFingerprintSha256) ||
    text(instaComp.registryFingerprintSha256) ||
    text(instaComp.pricingGroupKey) ||
    null
  );
}

export function summarizeInstaCompPricingGroup(
  rows: Array<{
    status?: string | null;
    quantity?: number | string | null;
    legacy_product_id?: number | null;
  }>,
) {
  return {
    exactChecklistIdentity: true as const,
    totalRows: rows.length,
    totalQuantity: rows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.quantity || 0)),
      0,
    ),
    pendingRows: rows.filter((row) => row.status === "draft").length,
    activeRows: rows.filter((row) => row.status === "active").length,
    listedProductIds: rows
      .filter((row) => row.status === "active")
      .map((row) => row.legacy_product_id)
      .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
  };
}
