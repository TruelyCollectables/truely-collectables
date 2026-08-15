import assert from "node:assert/strict";
import {
  buildLetterTrackShipStationLabelRequest,
  getLetterTrackShipStationBridgeStatus,
} from "../src/lib/lettertrack-shipstation";

const ENV_KEYS = [
  "TCOS_LETTERTRACK_SHIPSTATION_LIVE_ENABLED",
  "SHIPSTATION_API_KEY",
  "SHIPSTATION_CARRIER_ID",
  "SHIPSTATION_LETTER_SERVICE_CODE",
  "SHIPSTATION_LETTER_PACKAGE_CODE",
  "TCOS_SHIP_FROM_NAME",
  "TCOS_SHIP_FROM_COMPANY",
  "TCOS_SHIP_FROM_ADDRESS_LINE1",
  "TCOS_SHIP_FROM_ADDRESS_LINE2",
  "TCOS_SHIP_FROM_CITY",
  "TCOS_SHIP_FROM_STATE",
  "TCOS_SHIP_FROM_POSTAL_CODE",
  "TCOS_SHIP_FROM_COUNTRY",
] as const;

const original = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function clearBridgeEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreBridgeEnv() {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

try {
  clearBridgeEnv();

  const disabled = getLetterTrackShipStationBridgeStatus();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.ready, false);
  assert.equal(disabled.apiProduct, "ShipStation API (formerly ShipEngine)");
  assert.ok(disabled.missing.includes("SHIPSTATION_API_KEY"));
  assert.ok(disabled.missing.includes("SHIPSTATION_CARRIER_ID"));
  assert.equal(disabled.serviceCode, "usps_first_class_mail");
  assert.equal(disabled.packageCode, "letter");

  process.env.TCOS_LETTERTRACK_SHIPSTATION_LIVE_ENABLED = "true";
  process.env.SHIPSTATION_API_KEY = "test-api-key";
  process.env.SHIPSTATION_CARRIER_ID = "se-test-carrier";
  process.env.TCOS_SHIP_FROM_NAME = "Truely Collectables";
  process.env.TCOS_SHIP_FROM_ADDRESS_LINE1 = "456 Seller Ave";
  process.env.TCOS_SHIP_FROM_CITY = "Denver";
  process.env.TCOS_SHIP_FROM_STATE = "CO";
  process.env.TCOS_SHIP_FROM_POSTAL_CODE = "80202";
  process.env.TCOS_SHIP_FROM_COUNTRY = "US";

  const ready = getLetterTrackShipStationBridgeStatus();
  assert.equal(ready.enabled, true);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
  assert.equal(ready.requiresExplicitPurchaseConfirmation, true);
  assert.equal(ready.letterTrackFinalizeRequired, true);

  const request = buildLetterTrackShipStationLabelRequest({
    orderId: 1234,
    ounces: 1.25,
    shipDate: "2026-08-15",
    shipTo: {
      name: "Vegas Test",
      addressLine1: "123 Test Street",
      addressLine2: "Unit 4",
      city: "Las Vegas",
      state: "NV",
      postalCode: "89101",
      countryCode: "US",
    },
  });

  assert.equal(request.shipment.carrier_id, "se-test-carrier");
  assert.equal(request.shipment.service_code, "usps_first_class_mail");
  assert.equal(request.shipment.validate_address, "validate_and_clean");
  assert.equal(request.shipment.ship_date, "2026-08-15");
  assert.equal(request.shipment.external_order_id, "TCOS-1234");
  assert.equal("warehouse_id" in request.shipment, false);
  assert.equal(request.shipment.ship_from?.name, "Truely Collectables");
  assert.equal(request.shipment.ship_from?.postal_code, "80202");
  assert.equal(request.shipment.ship_to.city_locality, "Las Vegas");
  assert.equal(request.shipment.ship_to.state_province, "NV");
  assert.equal(request.shipment.packages[0]?.package_code, "letter");
  assert.equal(request.shipment.packages[0]?.weight.value, 1.25);
  assert.equal(request.shipment.packages[0]?.weight.unit, "ounce");
  assert.equal(request.label_format, "pdf");
  assert.equal(request.label_layout, "4x6");
  assert.equal(request.label_download_type, "url");

  assert.throws(
    () =>
      buildLetterTrackShipStationLabelRequest({
        orderId: 1,
        ounces: 3.51,
        shipTo: {
          name: "Too Heavy",
          addressLine1: "1 Main St",
          city: "Denver",
          state: "CO",
          postalCode: "80202",
          countryCode: "US",
        },
      }),
    /no more than 3\.5 ounces/i,
  );

  assert.throws(
    () =>
      buildLetterTrackShipStationLabelRequest({
        orderId: 2,
        ounces: 1,
        shipTo: {
          name: "International",
          addressLine1: "1 King St",
          city: "Toronto",
          state: "ON",
          postalCode: "M5H 1A1",
          countryCode: "CA",
        },
      }),
    /US-only/i,
  );

  console.log("LetterTrack ShipStation API bridge simulations passed.");
  console.log("- disabled/missing-provider gate passed");
  console.log("- explicit live enablement gate passed");
  console.log("- standalone /v1 label payload shape passed");
  console.log("- direct TCOS ship-from payload passed");
  console.log("- USPS First-Class Letter 4x6 PDF payload passed");
  console.log("- 3.5 oz and US-only guards passed");
  console.log("- no provider request or postage purchase was attempted");
} finally {
  restoreBridgeEnv();
}
