import assert from "node:assert/strict";
import fs from "node:fs";

const path = "src/app/api/release/issue253-marketplace-self-test/route.ts";
const source = fs.readFileSync(path, "utf8");

const checks = [
  ["Vercel team authorization helper", () => assert.match(source, /releaseRuntimeTeamIsAllowed/)],
  ["Vercel team validation endpoint", () => assert.match(source, /https:\/\/api\.vercel\.com\/v2\/teams\?limit=100/)],
  ["runtime cron secret source", () => assert.match(source, /process\.env\.CRON_SECRET/)],
  ["minimum runtime secret length", () => assert.match(source, /cronSecret\.length < 16/)],
  ["completed eBay order handler", () => assert.match(source, /runEbayOrderSaleSync/)],
  ["90-day completed order lookback", () => assert.match(source, /lookbackDays=90/)],
  ["authoritative eBay full sync handler", () => assert.match(source, /runEbayStoreFixedPriceSync/)],
  ["seller reconciliation handler", () => assert.match(source, /runSellerEbayReconciliation/)],
  ["sold archive handler", () => assert.match(source, /runSoldCollectibleArchive/)],
  ["internal bearer authorization", () => assert.match(source, /Authorization: `Bearer \$\{cronSecret\}`/)],
  ["strict step allowlist", () => assert.match(source, /Object\.hasOwn\(STEP_HANDLERS, step\)/)],
  ["strict upstream success", () => assert.match(source, /response\.status === 200 && payloadSuccess/)],
  ["configured status without value", () => assert.match(source, /cronSecretConfigured: true/)],
  ["sensitive-key redaction", () => assert.match(source, /token\|secret\|password\|authorization\|credential/i)],
  ["unauthorized status", () => assert.match(source, /status: 401/)],
  ["missing runtime configuration status", () => assert.match(source, /status: 503/)],
  ["runtime duration limit", () => assert.match(source, /export const maxDuration = 300/)],
  ["no secret response property", () => assert.doesNotMatch(source, /cronSecret\s*:\s*cronSecret/)],
  ["no raw secret result", () => assert.doesNotMatch(source, /result:\s*cronSecret/)],
  ["no raw secret error", () => assert.doesNotMatch(source, /error:\s*cronSecret/)],
];

for (const [name, check] of checks) {
  try {
    check();
  } catch (error) {
    throw new Error(`Runtime marketplace contract failed: ${name}`, {
      cause: error,
    });
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "issue253-marketplace-runtime-self-test",
      protectedByVercelTeamToken: true,
      runtimeCronSecretNonDisclosure: true,
      steps: [
        "ebay-order-sales",
        "ebay-full-sync",
        "seller-reconciliation",
        "sold-archive",
      ],
      checks: checks.length,
    },
    null,
    2,
  ),
);
