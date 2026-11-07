import assert from "node:assert/strict";
import { safeShipStationDownloadUrl } from "../src/lib/lettertrack-shipstation";
import {
  buildShipStationParcelLabelRequest,
  getShipStationParcelBridgeStatus,
} from "../src/lib/shipstation-parcel";

const ENV_KEYS = [
  "TCOS_SHIPSTATION_PARCEL_LIVE_ENABLED",
  "SHIPSTATION_API_KEY",
  "SHIPSTATION_CARRIER_ID",
  "SHIPSTATION_GROUND_ADVANTAGE_SERVICE_CODE",
  "SHIPSTATION_PRIORITY_MAIL_SERVICE_CODE",
  "SHIPSTATION_PARCEL_PACKAGE_CODE",
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

const shipTo = {
  name: "Vegas Parcel Test",
  addressLine1: "123 Test Street",
  city: "Las Vegas",
  state: "NV",
  postalCode: "89101",
  countryCode: "US",
};

try {
  clearBridgeEnv();

  const disabled = getShipStationParcelBridgeStatus();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.ready, false);
  assert.equal(disabled.apiProduct, "ShipStation API (formerly ShipEngine)");
  assert.ok(disabled.missing.includes("SHIPSTATION_API_KEY"));
  assert.ok(disabled.missing.includes("SHIPSTATION_CARRIER_ID"));
  assert.equal(disabled.groundAdvantageServiceCode, "usps_ground_advantage");
  assert.equal(disabled.priorityMailServiceCode, "usps_priority_mail");
  assert.equal(disabled.packageCode, "package");

  process.env.TCOS_SHIPSTATION_PARCEL_LIVE_ENABLED = "true";
  process.env.SHIPSTATION_API_KEY = "test-api-key";
  process.env.SHIPSTATION_CARRIER_ID = "se-test-carrier";
  process.env.TCOS_SHIP_FROM_NAME = "Truely Collectables";
  process.env.TCOS_SHIP_FROM_ADDRESS_LINE1 = "456 Seller Ave";
  process.env.TCOS_SHIP_FROM_CITY = "Denver";
  process.env.TCOS_SHIP_FROM_STATE = "CO";
  process.env.TCOS_SHIP_FROM_POSTAL_CODE = "80202";
  process.env.TCOS_SHIP_FROM_COUNTRY = "US";

  const ready = getShipStationParcelBridgeStatus();
  assert.equal(ready.enabled, true);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);

  const ground = buildShipStationParcelLabelRequest({
    orderId: 2001,
    method: "GROUND_ADVANTAGE",
    ounces: 4.5,
    lengthIn: 8,
    widthIn: 6,
    heightIn: 1,
    shipDate: "2026-08-15",
    shipTo,
  });

  assert.equal(ground.shipment.carrier_id, "se-test-carrier");
  assert.equal(ground.shipment.service_code, "usps_ground_advantage");
  assert.equal(ground.shipment.validate_address, "validate_and_clean");
  assert.equal(ground.shipment.ship_date, "2026-08-15");
  assert.equal(ground.shipment.external_order_id, "TCOS-2001");
  assert.equal("warehouse_id" in ground.shipment, false);
  assert.equal(ground.shipment.ship_from?.name, "Truely Collectables");
  assert.equal(ground.shipment.ship_from?.postal_code, "80202");
  assert.equal(ground.shipment.packages[0]?.package_code, "package");
  assert.equal(ground.shipment.packages[0]?.weight.value, 4.5);
  assert.equal(ground.shipment.packages[0]?.weight.unit, "ounce");
  assert.deepEqual(ground.shipment.packages[0]?.dimensions, {
    length: 8,
    width: 6,
    height: 1,
    unit: "inch",
  });
  assert.equal(ground.label_format, "pdf");
  assert.equal(ground.label_layout, "4x6");
  assert.equal(ground.label_download_type, "url");

  const priority = buildShipStationParcelLabelRequest({
    orderId: 2002,
    method: "PRIORITY_MAIL",
    ounces: 12,
    lengthIn: 10,
    widthIn: 8,
    heightIn: 2,
    shipTo,
  });
  assert.equal(priority.shipment.service_code, "usps_priority_mail");

  assert.throws(
    () =>
      buildShipStationParcelLabelRequest({
        orderId: 3,
        method: "GROUND_ADVANTAGE",
        ounces: 1120.01,
        lengthIn: 8,
        widthIn: 6,
        heightIn: 1,
        shipTo,
      }),
    /70 pounds/i,
  );

  assert.throws(
    () =>
      buildShipStationParcelLabelRequest({
        orderId: 4,
        method: "GROUND_ADVANTAGE",
        ounces: 4,
        lengthIn: 23,
        widthIn: 6,
        heightIn: 1,
        shipTo,
      }),
    /22 x 18 x 15/i,
  );

  assert.throws(
    () =>
      buildShipStationParcelLabelRequest({
        orderId: 5,
        method: "GROUND_ADVANTAGE",
        ounces: 4,
        lengthIn: 8,
        widthIn: 6,
        heightIn: 1,
        shipTo: { ...shipTo, countryCode: "CA" },
      }),
    /US-only/i,
  );

  assert.equal(
    safeShipStationDownloadUrl("https://api.shipengine.com/v1/downloads/abc.pdf"),
    "https://api.shipengine.com/v1/downloads/abc.pdf",
  );
  assert.equal(
    safeShipStationDownloadUrl("http://api.shipengine.com/v1/downloads/abc.pdf"),
    "https://api.shipengine.com/v1/downloads/abc.pdf",
  );
  assert.equal(
    safeShipStationDownloadUrl("https://api.shipengine.com.evil.example/abc.pdf"),
    null,
  );
  assert.equal(safeShipStationDownloadUrl("https://example.com/abc.pdf"), null);

  console.log("ShipStation API parcel bridge simulations passed.");
  console.log("- disabled/missing-provider gate passed");
  console.log("- explicit parcel live enablement gate passed");
  console.log("- standalone /v1 Ground Advantage and Priority payloads passed");
  console.log("- direct TCOS ship-from payload passed");
  console.log("- package weight/dimension and US-only guards passed");
  console.log("- ShipStation API PDF host allowlist passed");
  console.log("- no provider request or postage purchase was attempted");
} finally {
  restoreBridgeEnv();
}
