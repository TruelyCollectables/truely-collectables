export type DryRunShippingLabelLike = {
  metadata?: Record<string, unknown> | null;
  provider_label_id?: string | null;
  provider_shipment_id?: string | null;
  tracking_number?: string | null;
  coverage_policy_id?: string | null;
};

function metadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedRecord(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isDryRunShippingReference(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  return (
    normalized.includes("tcos-dryrun") ||
    normalized.startsWith("dryrun-") ||
    normalized.includes("tcos dry-run")
  );
}

export function isDryRunShippingLabel(
  label: DryRunShippingLabelLike | null | undefined,
) {
  if (!label) return false;

  const latestAttempt = metadataRecord(label.metadata, "latest_purchase_attempt");
  const purchaseResult = nestedRecord(latestAttempt, "purchase_result");
  const providerPayload = nestedRecord(purchaseResult, "rawProviderPayload");

  return (
    latestAttempt?.status === "dry_run_purchased" ||
    purchaseResult?.mode === "dry_run" ||
    providerPayload?.dry_run === true ||
    isDryRunShippingReference(label.provider_label_id) ||
    isDryRunShippingReference(label.provider_shipment_id) ||
    isDryRunShippingReference(label.coverage_policy_id) ||
    isDryRunShippingReference(label.tracking_number)
  );
}
