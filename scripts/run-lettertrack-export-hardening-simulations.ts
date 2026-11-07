import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLetterTrackExport,
  getLetterTrackExportBatchMetadata,
  LETTERTRACK_EXPORTED_STATUS,
  letterTrackCsvContent,
  letterTrackExportMetadata,
  type LetterTrackExportLabel,
  type LetterTrackExportOrder,
} from "../src/lib/lettertrack-export";

function order(overrides: Partial<LetterTrackExportOrder> = {}): LetterTrackExportOrder {
  return {
    id: 1001,
    customer_email: "buyer@example.com",
    customer_name: "Test Buyer",
    shipping_name: "Test Buyer",
    shipping_address_line1: "123 Main St",
    shipping_address_line2: null,
    shipping_city: "Denver",
    shipping_state: "co",
    shipping_postal_code: "80202-1234",
    shipping_country: "United States",
    subtotal: 12.5,
    total: 18.5,
    item_count: 1,
    ...overrides,
  };
}

function label(overrides: Partial<LetterTrackExportLabel> = {}): LetterTrackExportLabel {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    order_id: 1001,
    label_status: "planned",
    requested_shipping_method: "STANDARD_ENVELOPE",
    resolved_shipping_method: "STANDARD_ENVELOPE",
    coverage_amount: 12.5,
    coverage_status: "not_required",
    metadata: { standard_envelope_estimated_oz: 1 },
    created_at: "2026-08-15T12:00:00.000Z",
    provider_label_id: null,
    provider_shipment_id: null,
    tracking_number: null,
    coverage_policy_id: null,
    ...overrides,
  };
}

function build(orderRow: LetterTrackExportOrder, labelRow = label()) {
  return buildLetterTrackExport({
    labels: [labelRow],
    ordersById: new Map([[orderRow.id, orderRow]]),
    exportedAt: "2026-08-15T13:15:00.000Z",
  });
}

const valid = build(order());
assert.equal(valid.skipped.length, 0);
assert.equal(valid.rows.length, 1);
assert.equal(valid.rows[0].state, "CO");
assert.equal(valid.rows[0].postalCode, "80202-1234");
assert.equal(valid.rows[0].country, "US");

for (const [name, badOrder, expected] of [
  ["missing country", order({ shipping_country: null }), "country are required"],
  ["foreign country", order({ shipping_country: "CA" }), "restricted to United States"],
  ["bad state", order({ shipping_state: "Colorado" }), "two-letter US state"],
  ["bad ZIP", order({ shipping_postal_code: "8020" }), "valid 5-digit or ZIP\\+4"],
] as const) {
  const result = build(badOrder);
  assert.equal(result.rows.length, 0, name);
  assert.equal(result.skipped.length, 1, name);
  assert.match(result.skipped[0].reason, new RegExp(expected, "i"), name);
}

const wrongMethod = build(order(), label({ resolved_shipping_method: "GROUND_ADVANTAGE" }));
assert.equal(wrongMethod.rows.length, 0);
assert.match(wrongMethod.skipped[0].reason, /Only resolved Standard Envelope/i);

const formula = build(order({ shipping_name: "=HYPERLINK(\"https://evil.invalid\")" }));
const formulaCsv = letterTrackCsvContent(formula.rows);
assert.ok(formulaCsv.includes("'=HYPERLINK"), "CSV formula injection must be neutralized");
assert.ok(!formulaCsv.includes('\n=HYPERLINK'), "CSV must not emit an executable formula cell");

const batch = {
  batchId: "lettertrack-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  startedAt: "2026-08-15T13:00:00.000Z",
  exportedAt: "2026-08-15T13:00:00.000Z",
  candidateCount: 1,
  candidateDigest: "abc123",
};
const batchLabel = label({
  label_status: LETTERTRACK_EXPORTED_STATUS,
  metadata: {
    lettertrack_export: {
      ...letterTrackExportMetadata(batch),
      payload_digest: "payload123",
    },
  },
});
assert.deepEqual(getLetterTrackExportBatchMetadata(batchLabel), batch);

const routeSource = readFileSync(
  new URL("../src/app/api/admin/shipping/lettertrack-export/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /export async function POST\(request: Request\)/);
assert.match(routeSource, /method=\"post\"/);
assert.match(routeSource, /Idempotency-Key/);
assert.match(routeSource, /LETTERTRACK_EXPORTED_STATUS/);
assert.match(routeSource, /\.in\(\"label_status\", exportableStatuses\)/);
assert.match(routeSource, /isDryRunShippingLabel/);
assert.match(routeSource, /payloadDigest/);
assert.match(routeSource, /candidateDigest/);
assert.match(routeSource, /Export was blocked without mutation/i);

console.log("LETTERTRACK HARDENING PASS: strict US address validation");
console.log("LETTERTRACK HARDENING PASS: non-Standard Envelope rejection");
console.log("LETTERTRACK HARDENING PASS: CSV formula injection neutralization");
console.log("LETTERTRACK HARDENING PASS: persisted batch metadata round-trip");
console.log("LETTERTRACK HARDENING PASS: POST + conditional claim + idempotency guards present");
