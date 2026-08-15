import assert from "node:assert/strict";
import { testShipStationConnection } from "../src/lib/shipstation-connection";

const original = {
  apiKey: process.env.SHIPSTATION_API_KEY,
  carrierId: process.env.SHIPSTATION_CARRIER_ID,
  letterCode: process.env.SHIPSTATION_LETTER_SERVICE_CODE,
  groundCode: process.env.SHIPSTATION_GROUND_ADVANTAGE_SERVICE_CODE,
  priorityCode: process.env.SHIPSTATION_PRIORITY_MAIL_SERVICE_CODE,
  fetch: globalThis.fetch,
};

function restore() {
  if (original.apiKey === undefined) delete process.env.SHIPSTATION_API_KEY;
  else process.env.SHIPSTATION_API_KEY = original.apiKey;
  if (original.carrierId === undefined) delete process.env.SHIPSTATION_CARRIER_ID;
  else process.env.SHIPSTATION_CARRIER_ID = original.carrierId;
  if (original.letterCode === undefined) delete process.env.SHIPSTATION_LETTER_SERVICE_CODE;
  else process.env.SHIPSTATION_LETTER_SERVICE_CODE = original.letterCode;
  if (original.groundCode === undefined)
    delete process.env.SHIPSTATION_GROUND_ADVANTAGE_SERVICE_CODE;
  else process.env.SHIPSTATION_GROUND_ADVANTAGE_SERVICE_CODE = original.groundCode;
  if (original.priorityCode === undefined)
    delete process.env.SHIPSTATION_PRIORITY_MAIL_SERVICE_CODE;
  else process.env.SHIPSTATION_PRIORITY_MAIL_SERVICE_CODE = original.priorityCode;
  globalThis.fetch = original.fetch;
}

async function main() {
  try {
    delete process.env.SHIPSTATION_API_KEY;
    delete process.env.SHIPSTATION_CARRIER_ID;

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run without an API key");
    }) as typeof fetch;

    const missingKey = await testShipStationConnection();
    assert.equal(missingKey.ok, false);
    assert.equal(missingKey.apiKeyConfigured, false);
    assert.equal(missingKey.postagePurchaseAttempted, false);
    assert.equal(fetchCalls, 0);

    process.env.SHIPSTATION_API_KEY = "test-key";
    process.env.SHIPSTATION_CARRIER_ID = "se-usps-test";

    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();
      requests.push({ url, method });
      assert.equal(method, "GET");
      assert.notEqual(url, "https://api.shipstation.com/v2/labels");
      assert.equal(new Headers(init?.headers).get("API-Key"), "test-key");

      if (url.includes("/v2/carriers?page=")) {
        return new Response(
          JSON.stringify({
            carriers: [
              {
                carrier_id: "se-usps-test",
                carrier_code: "stamps_com",
                friendly_name: "USPS from ShipStation",
                nickname: "Truely USPS",
                account_number: "MUST-NOT-BE-RETURNED",
              },
              {
                carrier_id: "se-ups-test",
                carrier_code: "ups",
                friendly_name: "UPS",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v2/carriers/se-usps-test/services")) {
        return new Response(
          JSON.stringify({
            services: [
              {
                service_code: "usps_first_class_mail",
                name: "USPS First Class Mail",
                domestic: true,
                international: false,
              },
              {
                service_code: "usps_ground_advantage",
                name: "USPS Ground Advantage",
                domestic: true,
                international: false,
              },
              {
                service_code: "usps_priority_mail",
                name: "USPS Priority Mail",
                domestic: true,
                international: true,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ message: "unexpected URL" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const ready = await testShipStationConnection();
    assert.equal(ready.ok, true);
    assert.equal(ready.apiKeyConfigured, true);
    assert.equal(ready.configuredCarrierFound, true);
    assert.equal(ready.recommendedCarrierId, "se-usps-test");
    assert.equal(ready.requiredServices.letter.available, true);
    assert.equal(ready.requiredServices.groundAdvantage.available, true);
    assert.equal(ready.requiredServices.priorityMail.available, true);
    assert.equal(ready.postagePurchaseAttempted, false);
    assert.equal(ready.carriers.length, 2);
    assert.equal("accountNumber" in ready.carriers[0]!, false);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.method === "GET"));
    assert.ok(requests.every((request) => !request.url.includes("/v2/labels")));

    delete process.env.SHIPSTATION_CARRIER_ID;
    const autoRequests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      autoRequests.push(url);
      assert.equal(String(init?.method || "GET").toUpperCase(), "GET");
      if (url.includes("/v2/carriers?page=")) {
        return new Response(
          JSON.stringify({
            carriers: [
              {
                carrier_id: "se-only-usps",
                carrier_code: "stamps_com",
                friendly_name: "USPS from ShipStation",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/v2/carriers/se-only-usps/services")) {
        return new Response(
          JSON.stringify({
            services: [
              { service_code: "usps_first_class_mail", name: "Letter" },
              { service_code: "usps_ground_advantage", name: "Ground Advantage" },
              { service_code: "usps_priority_mail", name: "Priority Mail" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const autoSelected = await testShipStationConnection();
    assert.equal(autoSelected.ok, true);
    assert.equal(autoSelected.configuredCarrierId, null);
    assert.equal(autoSelected.recommendedCarrierId, "se-only-usps");
    assert.equal(autoSelected.postagePurchaseAttempted, false);
    assert.ok(autoRequests.every((url) => !url.includes("/v2/labels")));

    console.log("ShipStation connection diagnostic simulations passed.");
    console.log("- missing API key performs zero network calls");
    console.log("- configured carrier and service discovery passed");
    console.log("- single USPS carrier recommendation passed");
    console.log("- account numbers/secrets are not returned");
    console.log("- every simulated provider request was GET-only");
    console.log("- no /v2/labels request and no postage purchase was attempted");
  } finally {
    restore();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
