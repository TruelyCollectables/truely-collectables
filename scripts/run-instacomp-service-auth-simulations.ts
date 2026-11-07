import assert from "node:assert/strict";
import { isValidInstaCompServiceRequest } from "../src/lib/instacomp-job-server";

const expected = "profit-hunter-service-secret";

const valid = new Request("https://example.test/api/instacomp/live-scan", {
  headers: { "x-tcos-instacomp-service-token": expected },
});
assert.equal(isValidInstaCompServiceRequest(valid, expected), true);

const wrong = new Request("https://example.test/api/instacomp/live-scan", {
  headers: { "x-tcos-instacomp-service-token": "wrong-secret" },
});
assert.equal(isValidInstaCompServiceRequest(wrong, expected), false);

const missing = new Request("https://example.test/api/instacomp/live-scan");
assert.equal(isValidInstaCompServiceRequest(missing, expected), false);

const disabled = new Request("https://example.test/api/instacomp/live-scan", {
  headers: { "x-tcos-instacomp-service-token": expected },
});
assert.equal(isValidInstaCompServiceRequest(disabled, ""), false);

const whitespace = new Request("https://example.test/api/instacomp/live-scan", {
  headers: { "x-tcos-instacomp-service-token": `  ${expected}  ` },
});
assert.equal(isValidInstaCompServiceRequest(whitespace, `  ${expected}  `), true);

const acceptance = "a".repeat(64);
const acceptanceRequest = new Request("https://example.test/api/instacomp/scan", {
  headers: { "x-tcos-instacomp-service-token": acceptance },
});
assert.equal(
  isValidInstaCompServiceRequest(acceptanceRequest, expected, acceptance),
  true,
);
assert.equal(
  isValidInstaCompServiceRequest(valid, expected, acceptance),
  true,
);
const weakAcceptance = new Request("https://example.test/api/instacomp/scan", {
  headers: { "x-tcos-instacomp-service-token": "short" },
});
assert.equal(
  isValidInstaCompServiceRequest(weakAcceptance, expected, "short"),
  false,
);

console.log(
  "InstaComp service authentication passed: valid service token accepted; wrong, missing, and disabled credentials rejected.",
);
