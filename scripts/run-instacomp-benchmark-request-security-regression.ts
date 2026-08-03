import assert from "node:assert/strict";
import { adminMutationSecurityDecision } from "../src/lib/admin-request-security";
import {
  buildInstaCompBenchmarkLiveScanUrl,
  buildInstaCompBenchmarkSameOriginHeaders,
} from "../src/lib/instacomp-benchmark-request-security";
import { instaCompMutationSecurityDecision } from "../src/lib/instacomp-mutation-security";

const previewRequestUrl =
  "https://truely-collectables-preview.vercel.app/api/instacomp/benchmark/ebay-25";
const scanUrl = buildInstaCompBenchmarkLiveScanUrl(previewRequestUrl);
const headers = buildInstaCompBenchmarkSameOriginHeaders(scanUrl);

assert.equal(
  scanUrl.href,
  "https://truely-collectables-preview.vercel.app/api/instacomp/live-scan",
);
assert.deepEqual(Object.keys(headers).sort(), [
  "origin",
  "referer",
  "sec-fetch-site",
]);
assert.equal(headers.origin, scanUrl.origin);
assert.equal(new URL(headers.referer).origin, scanUrl.origin);
assert.equal(headers["sec-fetch-site"], "same-origin");

const allowedRequest = new Request(scanUrl, {
  method: "POST",
  headers,
});
const adminAllowed = adminMutationSecurityDecision(allowedRequest);
assert.equal(adminAllowed.allowed, true);

const instaCompAllowed = instaCompMutationSecurityDecision({
  request: allowedRequest,
  actor: { type: "admin", storeId: "store-fixture", sellerAccountId: null },
  expectedServiceToken: "",
});
assert.equal(instaCompAllowed.allowed, true);
assert.equal(instaCompAllowed.channel, "admin_same_origin");

const missingMetadata = adminMutationSecurityDecision(
  new Request(scanUrl, { method: "POST" }),
);
assert.equal(missingMetadata.allowed, false);
assert.equal(missingMetadata.code, "ADMIN_MUTATION_ORIGIN_PROOF_MISSING");

const mismatchedOrigin = adminMutationSecurityDecision(
  new Request(scanUrl, {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      referer: "https://attacker.example/fake",
      "sec-fetch-site": "cross-site",
    },
  }),
);
assert.equal(mismatchedOrigin.allowed, false);
assert.equal(mismatchedOrigin.code, "ADMIN_MUTATION_CROSS_ORIGIN");

const sameSiteOnly = adminMutationSecurityDecision(
  new Request(scanUrl, {
    method: "POST",
    headers: {
      origin: scanUrl.origin,
      "sec-fetch-site": "same-site",
    },
  }),
);
assert.equal(sameSiteOnly.allowed, false);
assert.equal(sameSiteOnly.code, "ADMIN_MUTATION_CROSS_ORIGIN");

for (const [name, value] of Object.entries(headers)) {
  assert.equal(/authorization|cookie|token|secret/i.test(name), false);
  assert.equal(/bearer|session|token|secret/i.test(value), false);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      scanUrl: scanUrl.href,
      channel: instaCompAllowed.channel,
      missingMetadataCode: missingMetadata.code,
      mismatchedOriginCode: mismatchedOrigin.code,
      sameSiteCode: sameSiteOnly.code,
    },
    null,
    2,
  ),
);
