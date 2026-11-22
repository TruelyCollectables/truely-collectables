// Run with NODE_PATH="$PWD/node_modules/next/dist/compiled" node --conditions=react-server --import tsx
import assert from "node:assert/strict";
import { ADMIN_SESSION_COOKIE_NAME, createAdminSessionValue } from "../src/lib/admin-session";
import { identifyOBBFBVision } from "../src/lib/obbfb-direct-vision";
import { GET, POST } from "../src/app/api/kingmaker/bulk-recomp/route";

async function run() {
  process.env.ADMIN_SESSION_SECRET = "kingmaker-test-only-session-secret";
  process.env.INSTACOMP_AI_LOCAL_KEY = "test-only-mac-key";
  process.env.INSTACOMP_AI_LOCAL_URL = "https://instacomp.truelycollectables.com";
  process.env.GEMINI_API_KEY = "test-only-gemini-key";
  const endpoint = "https://truelycollectables.com/api/kingmaker/bulk-recomp";
  const cookie = ADMIN_SESSION_COOKIE_NAME + "=" + await createAdminSessionValue();
  const identity = {
    year: "2024-25", brandSet: "Upper Deck", player: "Lane Hutson", cardNumber: "229",
    parallel: "Base", isAutograph: false, isRelic: false, confidence: 0.94,
  };
  const row = {
    inventoryItemId: "internal-1", ebayItemId: "111111111111", price: 42,
    metadata: { instacomp: { manualListingTitleLocked: true, humanVerified: true, ai: identity } },
  };
  let geminiStatus = 200;
  let researchCalls = 0;
  let cloudflareCalls = 0;
  let locked = false;
  let partial = false;
  Reflect.set(globalThis, Symbol.for("__cloudflare-context__"), {
    env: { AI: { run: async () => {
      cloudflareCalls++;
      return { response: JSON.stringify(identity) };
    } } },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    if (url.hostname === "generativelanguage.googleapis.com") {
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-only-gemini-key");
      assert.equal(url.search, "");
      const parts = body.contents[0].parts;
      assert.equal(parts[1].text, "FRONT CARD PHOTO");
      assert.equal(parts[3].text, "BACK CARD PHOTO");
      assert.notEqual(parts[2].inlineData.data, parts[4].inlineData.data);
      return Response.json({
        candidates: [{ finishReason: "STOP", content: { parts: [{
          text: JSON.stringify(partial ? { ...identity, parallel: null } : identity),
        }] } }],
      }, { status: geminiStatus });
    }
    if (url.pathname === "/v1/obbfb-inventory/commercial") {
      switch (body.action) {
        case "ebay_asking_prices":
          return Response.json({ ok: true, listings: [
            { itemId: row.ebayItemId, title: "Lane Hutson", price: 10 },
            { itemId: "222222222222", title: "Unlinked", price: 999.99 },
            { itemId: "333333333333", title: "Threshold", price: 1000 },
          ] });
        case "master_list":
        case "master_get":
          return Response.json({ ok: true, items: [{
            ...row, sellerPriceOverride: locked ? 42 : false,
          }] });
      }
    }
    if (url.pathname === "/v1/obbfb-market-comp/search") {
      researchCalls++;
      assert.equal(body.identity.player, identity.player);
      return Response.json({ sold: [12, 8].map((price, index) => ({
        title: "Lane Hutson #229", source: "mac_130point_exact_sold", sourceCategory: "sold",
        url: "https://www.ebay.com/itm/" + (222222222221 + index),
        price, soldAt: new Date(Date.now() - 86_400_000).toISOString(),
      })) });
    }
    assert.fail("Unexpected external call or write: " + url.pathname);
  };

  try {
    const front = new File([new Uint8Array([255, 216, 255, 1])], "front.jpg", { type: "image/jpeg" });
    const back = new File([new Uint8Array([255, 216, 255, 2])], "back.jpg", { type: "image/jpeg" });
    assert.equal((await identifyOBBFBVision(front, back)).model, "gemini-3.8-flash");
    partial = true;
    assert.ok((await identifyOBBFBVision(front, back)).identity.confidence < 0.7);
    assert.equal(cloudflareCalls, 0);
    geminiStatus = 429;
    assert.match((await identifyOBBFBVision(front, back)).model, /^@cf\//);
    assert.equal(cloudflareCalls, 1);

    assert.equal((await GET(new Request(endpoint))).status, 401);
    const preview = async (query: string) => (await GET(new Request(endpoint + query, { headers: { cookie } }))).json();
    const low = await preview("?max=10");
    assert.equal(low.listings.length, 1);
    assert.equal(low.listings[0].askingPrice, 10);
    assert.equal((await preview("?max=1000&exclusiveMax=1")).listings.length, 2);
    assert.equal((await preview("?min=1000")).listings.length, 1);
    assert.equal((await preview("?min=5&max=10")).listings.length, 1);
    const token = low.listings[0].token;
    const research = (token: string) => POST(new Request(endpoint, {
      method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ token }),
    }));
    assert.equal((await research("a" + token)).status, 400);
    locked = true;
    assert.equal((await (await research(token)).json()).status, "Seller locked");
    assert.equal((await preview("?max=10")).listings[0].token, null);
    assert.equal(researchCalls, 0);
    locked = false;
    const result = await (await research(token)).json();
    assert.equal(result.status, "comped");
    assert.equal(result.medianComp, 10);
    assert.equal(result.suggestedPrice, 12.99);
    assert.equal(result.evidence.length, 2);
    assert.equal(researchCalls, 1);
    console.log("PASS: paired Gemini, quota fallback, seller review, live-ask boundaries, price locks and read-only re-comp");
  } finally {
    globalThis.fetch = original;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
