import assert from "node:assert/strict";
import {
  assertSafeInstaCompRemoteImageUrl,
  sanitizeInstaCompProviderError,
} from "../src/lib/instacomp-provider-safety";

assert.equal(
  assertSafeInstaCompRemoteImageUrl(
    "https://i.ebayimg.com/images/g/example/s-l1600.jpg#ignored",
    { ebayOnly: true },
  ),
  "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
);

for (const unsafe of [
  "http://i.ebayimg.com/card.jpg",
  "https://localhost/card.jpg",
  "https://127.0.0.1/card.jpg",
  "https://example.com/card.jpg",
  "https://user:password@i.ebayimg.com/card.jpg",
  "https://i.ebayimg.com:8443/card.jpg",
]) {
  assert.throws(
    () => assertSafeInstaCompRemoteImageUrl(unsafe, { ebayOnly: true }),
    `Unsafe competition image URL should be rejected: ${unsafe}`,
  );
}

const fakeKey = ["sk", "proj", "abcdef123456789"].join("-");
const fakeBearer = ["abc", "def", "ghi"].join(".");
const sanitized = sanitizeInstaCompProviderError(
  `Incorrect API key provided: ${fakeKey} and Authorization: Bearer ${fakeBearer}`,
);
assert.doesNotMatch(sanitized, /abcdef123456789|abc\.def\.ghi/);
assert.match(sanitized, /REDACTED/);

console.log(
  "InstaComp provider-safety regressions passed: HTTPS/host enforcement and credential redaction.",
);
