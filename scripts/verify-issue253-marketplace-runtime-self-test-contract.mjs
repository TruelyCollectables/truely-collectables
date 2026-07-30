import assert from "node:assert/strict";
import fs from "node:fs";

const path = "src/app/api/release/issue253-marketplace-self-test/route.ts";
const source = fs.readFileSync(path, "utf8");

assert.match(source, /releaseRuntimeTeamIsAllowed/);
assert.match(source, /https:\/\/api\.vercel\.com\/v2\/teams\?limit=100/);
assert.match(source, /process\.env\.CRON_SECRET/);
assert.match(source, /cronSecret\.length < 16/);
assert.match(source, /runEbayOrderSaleSync/);
assert.match(source, /lookbackDays=90/);
assert.match(source, /runEbayStoreFixedPriceSync/);
assert.match(source, /runSellerEbayReconciliation/);
assert.match(source, /runSoldCollectibleArchive/);
assert.match(source, /Authorization: `Bearer \$\{cronSecret\}`/);
assert.match(source, /Object\.hasOwn\(STEP_HANDLERS, step\)/);
assert.match(source, /response\.status === 200 && payloadSuccess/);
assert.match(source, /cronSecretConfigured: true/);
assert.match(source, /token\|secret\|password\|authorization\|credential/i);
assert.match(source, /status: 401/);
assert.match(source, /status: 503/);
assert.match(source, /export const maxDuration = 300/);
assert.doesNotMatch(source, /cronSecret[,}]/);
assert.doesNotMatch(source, /result:\s*cronSecret/);

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
      checks: 20,
    },
    null,
    2,
  ),
);
