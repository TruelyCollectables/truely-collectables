// Run with NODE_PATH="$PWD/node_modules/next/dist/compiled" node --conditions=react-server --import tsx
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as intake } from "../src/app/api/kingmaker/obbfb-intake/route";
import { ADMIN_SESSION_COOKIE_NAME, createAdminSessionValue } from "../src/lib/admin-session";
import { POST as lockDraft } from "../src/app/api/kingmaker/obbfb-lock/route";
import { identifyOBBFBVision, parseOBBFBVisionJson } from "../src/lib/obbfb-direct-vision";
import { GET, POST } from "../src/app/api/kingmaker/bulk-recomp/route";

async function run() {
  process.env.ADMIN_SESSION_SECRET = "kingmaker-test-only-session-secret";
  process.env.INSTACOMP_AI_LOCAL_KEY = "test-only-mac-key";
  process.env.INSTACOMP_AI_LOCAL_URL = "https://instacomp.truelycollectables.com";
  process.env.GEMINI_API_KEY = "test-only-gemini-key";
  const endpoint = "https://truelycollectables.com/api/kingmaker/bulk-recomp";
  const cookie = ADMIN_SESSION_COOKIE_NAME + "=" + await createAdminSessionValue();
  const identity = {
    year: "2024-25", printedReleaseYear: "2024-25", copyrightYear: "2025", brandSet: "Upper Deck", player: "Lane Hutson", cardNumber: "229",
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
  let noSold = false;
  let clearance = false;
  let clearanceWrites = 0;
  let created = 0;
  let archived = 0;
  let lockableDraft: Record<string, unknown> | null = null;
  const scanId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
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
    if (url.pathname === "/v1/scans/supervised-archive") {
      assert.ok(init?.body instanceof FormData);
      archived++;
      return Response.json({ scan_id: scanId, card_uuid: scanId, status: "supervised_archive_pending_lesson", front_sha256: "a".repeat(64), back_sha256: "b".repeat(64), image_pair_sha256: "c".repeat(64) });
    }
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
        case "find_image_pair":
          return Response.json({ ok: true, items: [] });
        case "create":
          assert.equal(body.items[0].price, clearance ? 0 : 12.99);
          created++;
          lockableDraft = body.items[0];
          return Response.json({ ok: true, items: body.items });
        case "project_master":
          return Response.json({ ok: true });
        case "master_update":
          assert.equal(body.items[0].price, clearance ? 1.25 : 1);
          if (clearance) {
            assert.equal(body.items[0].obbfbOperatorSave, false);
            clearanceWrites++;
          }
          assert.equal(body.items[0].updateEbay, false);
          assert.equal(body.items[0].metadata.instacomp.sellerPriceOverride, true);
          return Response.json({ ok: true, results: [{ success: true, item: body.items[0] }] });
        case "master_get":
          if (body.items[0].inventoryItemId === scanId) {
            return Response.json({ ok: true, items: lockableDraft ? [lockableDraft] : [] });
          }
        // falls through: both fixture paths return the same active card
        case "master_list":
          return Response.json({ ok: true, items: [{
            ...row, sellerPriceOverride: locked ? 42 : false,
          }] });
      }
    }
    if (url.pathname === "/v1/obbfb-market-comp/search") {
      researchCalls++;
      if (noSold) return Response.json({ sold: [] });
      assert.equal(body.identity.player, identity.player);
      return Response.json({ sold: (clearance ? [1.50, 1.55] : [12, 8]).map((price, index) => ({
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
    assert.equal(parseOBBFBVisionJson(JSON.stringify({
      ...identity, year: "2024", printedReleaseYear: "2026", copyrightYear: "2026",
    })).year, null);
    assert.equal(parseOBBFBVisionJson(JSON.stringify({
      ...identity, year: "2026", printedReleaseYear: "2026", copyrightYear: "2026",
    })).year, "2026");
    const collier = parseOBBFBVisionJson(JSON.stringify({
      ...identity, year: null, printedReleaseYear: null, copyrightYear: null,
      player: "Napheesa Collier", cardNumber: "41", brandSet: "WNBA Prizm Basketball",
      parallel: "Blue Prizm", notes: "The back explicitly states '2026 PANINI – WNBA PRIZM BASKETBALL' and '© 2026'.",
    }));
    assert.equal(collier.year, "2026");
    assert.equal(collier.parallel, null);
    assert.ok(collier.confidence < 0.7);
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
    geminiStatus = 200;
    const scanPair = () => {
      const form = new FormData();
      form.set("front", front);
      form.set("back", back);
      return intake(new NextRequest("https://truelycollectables.com/api/kingmaker/obbfb-intake",
        { method: "POST", headers: { cookie }, body: form }));
    };
    partial = true;
    assert.equal((await (await scanPair()).json()).code, "OBBFB_NOT_SAVED");
    assert.equal(created, 0);
    partial = false;
    noSold = true;
    assert.equal((await (await scanPair()).json()).code, "OBBFB_NOT_SAVED");
    assert.equal(created, 0);
    noSold = false;
    const staged = await (await scanPair()).json();
    assert.equal(staged.pricingSucceeded, true);
    const save = await lockDraft(new NextRequest("https://truelycollectables.com/api/kingmaker/obbfb-lock", {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true, inventoryItemId: scanId, price: 1,
        identity: staged.ai, title: staged.title, description: staged.description,
      }),
    }));
    assert.equal(save.status, 200);
    const saved = await save.json();
    assert.equal(saved.price, 1);
    assert.equal(saved.published, false);
    assert.equal(created, 1);
    assert.equal(archived, 3);
    lockableDraft = null;
    clearance = true;
    const stagedLow = await (await scanPair()).json();
    assert.equal(stagedLow.pricing.suggestedPrice, 0);
    const bulkLock = () => lockDraft(new NextRequest("https://truelycollectables.com/api/kingmaker/obbfb-lock", {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, inventoryItemId: scanId, price: 1.25, mode: "bulk_clearance" }),
    }));
    const bulkSaved = await (await bulkLock()).json();
    assert.equal(bulkSaved.price, 1.25);
    lockableDraft = { ...lockableDraft as unknown as Record<string, unknown>, price: 1.25 };
    assert.equal((await bulkLock()).status, 409);
    assert.equal(clearanceWrites, 1);
    console.log("PASS: paired Gemini, quota fallback, seller review, live-ask boundaries, price locks and read-only re-comp");
  } finally {
    globalThis.fetch = original;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
