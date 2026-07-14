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
  tcosStatus: string;
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
  "tcosStatus",
  "notes",
];

export const LETTERTRACK_CSV_HEADERS = csvHeaders;

function text(value: unknown) {
  return String(value || "").trim();
}

function money(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function metadataNumber(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function csvCell(value: unknown) {
  const raw = text(value);
  const escaped = raw.replaceAll('"', '""');

  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function letterTrackCsvContent(rows: LetterTrackExportRow[]) {
  return [
    csvHeaders.join(","),
    ...rows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
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

    const addressLine1 = text(order.shipping_address_line1);
    const city = text(order.shipping_city);
    const state = text(order.shipping_state);
    const postalCode = text(order.shipping_postal_code);
    const recipientName =
      text(order.shipping_name) ||
      text(order.customer_name) ||
      text(order.customer_email);

    if (!recipientName || !addressLine1 || !city || !state || !postalCode) {
      skipped.push({
        orderId: label.order_id,
        labelId: label.id,
        reason:
          "Recipient name, address line 1, city, state, and postal code are required before LetterTrack export.",
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
      recipientName,
      recipientEmail: text(order.customer_email),
      addressLine1,
      addressLine2: text(order.shipping_address_line2),
      city,
      state,
      postalCode,
      country: text(order.shipping_country) || "US",
      declaredValue,
      itemCount: String(order.item_count || 1),
      internalReference: `${orderNumber}-${label.id.slice(0, 8)}`,
      postageInstruction:
        estimatedOunces && estimatedOunces > 0
          ? `USPS First-Class letter with LetterTrack IMb, estimated ${estimatedOunces} oz; apply current USPS postage.`
          : "USPS First-Class letter with LetterTrack IMb; apply current USPS postage.",
      trackingProvider: "LetterTrack / USPS Informed Visibility IMb",
      coverageInstruction:
        "TCOS under-$20 seller protection is internal and item-only when the seller opted in; LetterTrack provides delivery evidence, not external insurance.",
      sellerProtectionProgram: "TCOS Under-$20 Seller Protection",
      sellerProtectionOptInRequired: "yes - seller must opt in per shipment",
      sellerProtectionReserveRate: "2%",
      sellerProtectionMaxCoverage: "$20.00 item sale amount",
      sellerProtectionCoverageBasis: "item_sale_amount_excluding_shipping",
      sellerProtectionReimbursesShipping: "no",
      deliveryEvidenceRequirement:
        "USPS IMb / LetterTrack status must show delivered to close the delivery trail; not-delivered, exception, or returned evidence supports claim review.",
      tcosStatus: label.label_status || "planned",
      notes:
        "After LetterTrack prints/assigns the IMb, record the IMb/tracking reference back on the TCOS shipping label before marking shipped.",
    });
  }

  return { exportedAt, rows, skipped };
}
