import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Connector exited before health check.\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return response.json();
    } catch {
      // Server may still be starting.
    }
    await delay(100);
  }
  throw new Error(`Connector did not become healthy.\n${output.join("")}`);
}

function structured(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((entry) => entry.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

test("starts the real MCP server and exercises core tools", { timeout: 30_000 }, async (t) => {
  const port = 18_000 + (process.pid % 10_000);
  const token = "integration-test-token";
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TCOS_CONNECTOR_TOKEN: token,
      TCOS_REQUIRE_PERSISTENCE: "false",
      TCOS_ALLOWED_ORIGINS: "https://chatgpt.com",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      OPENAI_API_KEY: "",
      EBAY_BROWSE_ACCESS_TOKEN: "",
      X_BEARER_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  t.after(async () => {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(2_000)]);
    }
  });

  const health = await waitForHealth(baseUrl, child, output);
  assert.equal(health.ok, true);
  assert.equal(health.persistence.mode, "memory");
  assert.equal(health.persistence.persistent, false);

  const privacyResponse = await fetch(`${baseUrl}/privacy`);
  assert.equal(privacyResponse.status, 200);
  const privacy = await privacyResponse.json();
  assert.equal(privacy.credentialsStored, false);
  assert.equal(privacy.privateGroupBypass, false);
  assert.equal(privacy.purchasesWithoutUserApproval, false);

  const unauthorized = await fetch(`${baseUrl}/mcp`);
  assert.equal(unauthorized.status, 401);

  const forbiddenOrigin = await fetch(`${baseUrl}/mcp`, {
    headers: { Authorization: `Bearer ${token}`, Origin: "https://malicious.example" },
  });
  assert.equal(forbiddenOrigin.status, 403);

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "tcos-connector-integration-test", version: "1.0.0" });
  await client.connect(transport);
  t.after(() => client.close().catch(() => undefined));

  const toolList = await client.listTools();
  const names = new Set(toolList.tools.map((tool) => tool.name));
  for (const required of [
    "connector_status",
    "run_saved_search",
    "ingest_listing",
    "instacomp_card",
    "instacomp_lot",
    "calculate_offer_and_profit",
    "evaluate_seller_risk",
    "record_purchase",
    "mark_received",
    "record_sale",
    "get_portfolio_summary",
  ]) {
    assert.equal(names.has(required), true, `Missing MCP tool: ${required}`);
  }

  const status = structured(await client.callTool({ name: "connector_status", arguments: {} }));
  assert.equal(status.privacy.passwordCookieOrSessionStorage, false);
  assert.equal(status.privacy.privateFacebookGroupAutomation, false);

  const offer = structured(
    await client.callTool({
      name: "calculate_offer_and_profit",
      arguments: {
        askingPrice: 10,
        shipping: 2,
        tax: 1,
        resalePrice: 25,
        buyerShipping: 2,
        outboundShipping: 0.78,
        supplies: 0.25,
        targetRoi: 0.1,
      },
    }),
  );
  assert.equal(offer.acquisition.deliveredCost, 13);
  assert.ok(offer.resale.netProfit > 7);
  assert.ok(offer.offer.maximumOffer > offer.offer.targetOffer);

  const purchase = structured(
    await client.callTool({
      name: "record_purchase",
      arguments: {
        source: "eBay",
        sourceItemId: "integration-item-1",
        orderNumber: "integration-order-1",
        quantity: 10,
        deliveredCost: 20,
        status: "awaiting_receipt",
      },
    }),
  );
  assert.equal(purchase.quantity, 10);
  assert.equal(purchase.deliveredCost, 20);

  const summary = structured(await client.callTool({ name: "get_portfolio_summary", arguments: {} }));
  assert.equal(summary.totals.purchaseLots, 1);
  assert.equal(summary.totals.unitsPurchased, 10);
  assert.equal(summary.totals.awaitingReceipt, 10);
  assert.equal(summary.totals.capitalDeployed, 20);
});
