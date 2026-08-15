export type LetterTrackExportOrder = {
  id: number;
  customer_email: string | null;
  customer_name: string | null;
  shipping_name: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  subtotal: number | string | null;
  total: number | string | null;
  item_count: number | null;
};

export type LetterTrackExportLabel = {
  id: string;
  order_id: number;
  label_status: string | null;
  requested_shipping_method: string | null;
  resolved_shipping_method: string | null;
  coverage_amount: number | string | null;
  coverage_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  provider_label_id?: string | null;
  provider_shipment_id?: string | null;
  tracking_number?: string | null;
  coverage_policy_id?: string | null;
};

export type LetterTrackExportBatchMetadata = {
  batchId: string;
  startedAt: string;
  exportedAt: string;
  candidateCount: number;
  candidateDigest: string;
};

export type LetterTrackExportRow = {
  orderNumber: string;
  labelId: string;
  recipientName: string;
  recipientEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  declaredValue: string;
  itemCount: string;
  internalReference: string;
  postageInstruction: string;
  trackingProvider: string;
  coverageInstruction: string;
  sellerProtectionProgram: string;
  sellerProtectionOptInRequired: string;
  sellerProtectionReserveRate: string;
  sellerProtectionMaxCoverage: string;
  sellerProtectionCoverageBasis: string;
  sellerProtectionReimbursesShipping: string;
  deliveryEvidenceRequirement: string;
  fulfillmentStatus: string;
  notes: string;
};

export type LetterTrackExportBuildResult = {
  exportedAt: string;
  rows: LetterTrackExportRow[];
  skipped: Array<{
    orderId: number;
    labelId: string;
    reason: string;
  }>;
};

export const LETTERTRACK_EXPORT_METADATA_KEY = "lettertrack_export";
export const LETTERTRACK_EXPORTED_STATUS = "lettertrack_exported";
export const LETTERTRACK_EXPORTABLE_STATUSES = [
  "planned",
  "purchase_pending",
  "rate_selected",
] as const;

const US_COUNTRY_NAMES = new Set([
  "US",
  "USA",
  "UNITED STATES",
  "UNITED STATES OF AMERICA",
]);

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

const ZIP_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/;

const csvHeaders: Array<keyof LetterTrackExportRow> = [
  "orderNumber",
  "labelId",
  "recipientName",
  "recipientEmail",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "declaredValue",
  "itemCount",
  "internalReference",
  "postageInstruction",
  "trackingProvider",
  "coverageInstruction",
  "sellerProtectionProgram",
  "sellerProtectionOptInRequired",
  "sellerProtectionReserveRate",
  "sellerProtectionMaxCoverage",
  "sellerProtectionCoverageBasis",
  "sellerProtectionReimbursesShipping",
  "deliveryEvidenceRequirement",
  "fulfillmentStatus",
  "notes",
];

export const LETTERTRACK_CSV_HEADERS = csvHeaders;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function metadataNumber(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataRecord(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function csvCell(value: unknown) {
  let raw = text(value);
  if (/^[=+\-@]/.test(raw)) raw = `'${raw}`;
  const escaped = raw.replaceAll('"', '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function letterTrackCsvContent(rows: LetterTrackExportRow[]) {
  return [
    csvHeaders.join(","),
    ...rows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

export function letterTrackSkippedReasonSummary(
  skipped: LetterTrackExportBuildResult["skipped"],
) {
  if (skipped.length === 0) return "none";

  const counts = new Map<string, number>();
  for (const row of skipped) {
    counts.set(row.reason, (counts.get(row.reason) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => `${reason} (${count})`)
    .join("; ");
}

export function getLetterTrackExportBatchMetadata(
  label: Pick<LetterTrackExportLabel, "metadata">,
): LetterTrackExportBatchMetadata | null {
  const record = metadataRecord(label.metadata, LETTERTRACK_EXPORT_METADATA_KEY);
  if (!record) return null;

  const batchId = text(record.batch_id);
  const startedAt = text(record.started_at);
  const exportedAt = text(record.exported_at);
  const candidateDigest = text(record.candidate_digest);
  const candidateCount = Number(record.candidate_count);

  if (
    !batchId ||
    !startedAt ||
    !exportedAt ||
    !candidateDigest ||
    !Number.isInteger(candidateCount) ||
    candidateCount < 1
  ) {
    return null;
  }

  return { batchId, startedAt, exportedAt, candidateCount, candidateDigest };
}

export function letterTrackExportMetadata(params: LetterTrackExportBatchMetadata) {
  return {
    batch_id: params.batchId,
    started_at: params.startedAt,
    exported_at: params.exportedAt,
    candidate_count: params.candidateCount,
    candidate_digest: params.candidateDigest,
    source: "admin_lettertrack_export",
    version: 2,
  };
}

function normalizedUsAddress(order: LetterTrackExportOrder) {
  const recipientName =
    text(order.shipping_name) ||
    text(order.customer_name) ||
    text(order.customer_email);
  const addressLine1 = text(order.shipping_address_line1);
  const addressLine2 = text(order.shipping_address_line2);
  const city = text(order.shipping_city);
  const state = text(order.shipping_state).toUpperCase();
  const postalCode = text(order.shipping_postal_code);
  const country = text(order.shipping_country).toUpperCase();

  if (!recipientName || !addressLine1 || !city || !state || !postalCode || !country) {
    return {
      ok: false as const,
      reason:
        "Recipient name, address line 1, city, state, postal code, and country are required before LetterTrack export.",
    };
  }

  if (!US_COUNTRY_NAMES.has(country)) {
    return {
      ok: false as const,
      reason: "LetterTrack Standard Envelope export is restricted to United States addresses.",
    };
  }

  if (!US_STATE_CODES.has(state)) {
    return {
      ok: false as const,
      reason: "Shipping state must be a valid two-letter US state or territory code.",
    };
  }

  if (!ZIP_CODE_PATTERN.test(postalCode)) {
    return {
      ok: false as const,
      reason: "Shipping postal code must be a valid 5-digit or ZIP+4 US postal code.",
    };
  }

  return {
    ok: true as const,
    recipientName,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country: "US",
  };
}

export function buildLetterTrackExport(params: {
  labels: LetterTrackExportLabel[];
  ordersById: Map<number, LetterTrackExportOrder>;
  exportedAt?: string;
}): LetterTrackExportBuildResult {
  const exportedAt = params.exportedAt || new Date().toISOString();
  const rows: LetterTrackExportRow[] = [];
  const skipped: LetterTrackExportBuildResult["skipped"] = [];

  for (const label of params.labels) {
    const order = params.ordersById.get(label.order_id);

    if (!order) {
      skipped.push({
        orderId: label.order_id,
        labelId: label.id,
        reason: "Order row was not found for this Standard Envelope label.",
      });
      continue;
    }

    if (label.resolved_shipping_method !== "STANDARD_ENVELOPE") {
      skipped.push({
        orderId: label.order_id,
        labelId: label.id,
        reason: "Only resolved Standard Envelope labels may be exported to LetterTrack.",
      });
      continue;
    }

    const address = normalizedUsAddress(order);
    if (!address.ok) {
      skipped.push({
        orderId: label.order_id,
        labelId: label.id,
        reason: address.reason,
      });
      continue;
    }

    const estimatedOunces = metadataNumber(
      label.metadata,
      "standard_envelope_estimated_oz",
    );
    const declaredValue = money(label.coverage_amount || order.subtotal || order.total);
    const orderNumber = `TCOS-${order.id}`;

    rows.push({
      orderNumber,
      labelId: label.id,
      recipientName: address.recipientName,
      recipientEmail: text(order.customer_email),
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      declaredValue,
      itemCount: String(order.item_count || 1),
      internalReference: `${orderNumber}-${label.id.slice(0, 8)}`,
      postageInstruction:
        estimatedOunces && estimatedOunces > 0
          ? `USPS First-Class letter with LetterTrack IMb, estimated ${estimatedOunces} oz; apply current USPS metered postage.`
          : "USPS First-Class letter with LetterTrack IMb; weigh the sealed letter and apply current USPS metered postage.",
      trackingProvider: "LetterTrack / USPS Informed Visibility IMb",
      coverageInstruction:
        "TCOS Under-$20 Seller Protection is an optional internal, item-only seller program; LetterTrack provides delivery evidence, not external insurance.",
      sellerProtectionProgram: "TCOS Under-$20 Seller Protection",
      sellerProtectionOptInRequired: "seller must opt in per shipment",
      sellerProtectionReserveRate: "2%",
      sellerProtectionMaxCoverage: "$20.00 item sale amount",
      sellerProtectionCoverageBasis: "item_sale_amount_excluding_shipping",
      sellerProtectionReimbursesShipping: "no",
      deliveryEvidenceRequirement:
        "Record the LetterTrack status and USPS IMb scan trail. Seller-protection review requires delivery evidence that does not show delivered status under TCOS rules.",
      fulfillmentStatus: label.label_status || "planned",
      notes:
        "After LetterTrack prints or assigns the IMb, record the IMb reference in TCOS before marking the order shipped.",
    });
  }

  return { exportedAt, rows, skipped };
}
