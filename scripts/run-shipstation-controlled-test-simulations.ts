import assert from "node:assert/strict";
import { controlledTestStatus } from "../src/lib/shipstation-controlled-test";

const original = {
  enabled: process.env.TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED,
  cap: process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE,
  fetch: globalThis.fetch,
};

function restore() {
  if (original.enabled === undefined) delete process.env.TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED;
  else process.env.TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED = original.enabled;
  if (original.cap === undefined) delete process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE;
  else process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE = original.cap;
  globalThis.fetch = original.fetch;
}

try {
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("controlledTestStatus must not call a provider");
  }) as typeof fetch;

  delete process.env.TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED;
  delete process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE;

  const locked = controlledTestStatus();
  assert.equal(locked.purchaseEnabled, false);
  assert.equal(locked.maxPostage, 2);
  assert.equal(locked.serviceCode, "usps_first_class_mail");
  assert.equal(locked.packageCode, "letter");
  assert.equal(locked.ounces, 1);
  assert.equal(networkCalls, 0);

  process.env.TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED = "true";
  process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE = "1.25";
  const armed = controlledTestStatus();
  assert.equal(armed.purchaseEnabled, true);
  assert.equal(armed.maxPostage, 1.25);
  assert.equal(armed.serviceCode, "usps_first_class_mail");
  assert.equal(armed.packageCode, "letter");
  assert.equal(armed.ounces, 1);
  assert.equal(networkCalls, 0);

  process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE = "not-a-number";
  assert.equal(controlledTestStatus().maxPostage, 2);
  assert.equal(networkCalls, 0);

  console.log("Controlled ShipStation test shipment safety simulations passed.");
  console.log("- purchase lane locked by default");
  console.log("- default real-postage cap is $2.00");
  console.log("- lane is fixed to USPS First-Class Mail / letter / 1 oz");
  console.log("- explicit enablement and custom cap parsing passed");
  console.log("- status checks made zero provider requests and purchased no postage");
} finally {
  restore();
}
