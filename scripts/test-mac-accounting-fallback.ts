import assert from "node:assert/strict";
import { getInstaCompMacAccounting, postInstaCompMacAccounting } from "../src/lib/instacomp-mac-accounting-client";

async function main() {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.INSTACOMP_AI_LOCAL_URL;
  const originalKey = process.env.INSTACOMP_AI_LOCAL_KEY;
  const originalFlag = process.env.KINGMAKER_LOCAL_MAC_BRIDGE;
  const calls: Array<{url: string; init: RequestInit}> = [];
  try {
    process.env.KINGMAKER_LOCAL_MAC_BRIDGE = "0";
    process.env.INSTACOMP_AI_LOCAL_KEY = "test-key-no-real-network";
    process.env.INSTACOMP_AI_LOCAL_URL = "https://instacomp.truelycollectables.com";
    globalThis.fetch = async (url: any, init: RequestInit = {}) => {
      calls.push({url: String(url), init});
      return Response.json({error: "Cloudflare blocked request"}, {status: 403});
    };
    await assert.rejects(postInstaCompMacAccounting("/v1/kingmaker/accounting/ebay-bridge", {mode: "readiness"}), /Cloudflare blocked request/);
    assert.equal(calls.length, 1, "public failure must not retry into Cloudflare localhost");
    assert.equal(calls[0].url, "https://instacomp.truelycollectables.com/v1/kingmaker/accounting/ebay-bridge");
    assert.equal((calls[0].init.headers as Record<string, string>)["User-Agent"], "TruelyCollectables-Kingmaker-Accounting/1.0");

    calls.length = 0;
    await assert.rejects(getInstaCompMacAccounting("/v1/kingmaker/accounting/pending-receipts"), /Cloudflare blocked request/);
    assert.equal(calls.length, 1, "public GET must not fall back into localhost");

    calls.length = 0;
    process.env.INSTACOMP_AI_LOCAL_URL = "http://127.0.0.1:8787";
    globalThis.fetch = async (url: any, init: RequestInit = {}) => {
      calls.push({url: String(url), init});
      return calls.length === 1
        ? Response.json({error: "first listener down"}, {status: 503})
        : Response.json({ok: true});
    };
    const result = await postInstaCompMacAccounting("/v1/kingmaker/accounting/listing-readiness", {inventory_item_ids: []});
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((x) => x.url), [
      "http://127.0.0.1:8787/v1/kingmaker/accounting/listing-readiness",
      "http://127.0.0.1:8796/v1/kingmaker/accounting/listing-readiness",
    ]);
    console.log("PASS: remote only, identified requests, local fallback only on Mac");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.INSTACOMP_AI_LOCAL_URL; else process.env.INSTACOMP_AI_LOCAL_URL = originalUrl;
    if (originalKey === undefined) delete process.env.INSTACOMP_AI_LOCAL_KEY; else process.env.INSTACOMP_AI_LOCAL_KEY = originalKey;
    if (originalFlag === undefined) delete process.env.KINGMAKER_LOCAL_MAC_BRIDGE; else process.env.KINGMAKER_LOCAL_MAC_BRIDGE = originalFlag;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
