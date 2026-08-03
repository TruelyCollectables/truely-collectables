import assert from "node:assert/strict";
import {
  assertTrustedInstaCompMutationRequest,
  instaCompMutationSecurityDecision,
} from "../src/lib/instacomp-mutation-security";
import type { InstaCompJobActor } from "../src/lib/instacomp-job-server";

const adminActor: InstaCompJobActor = {
  type: "admin",
  storeId: "00000000-0000-4000-8000-000000000001",
  sellerAccountId: null,
};
const sellerActor: InstaCompJobActor = {
  type: "seller",
  storeId: "00000000-0000-4000-8000-000000000001",
  sellerAccountId: "00000000-0000-4000-8000-000000000002",
};
const serviceToken = "round-two-service-token-with-at-least-32-characters";

function request(headers: Record<string, string> = {}) {
  return new Request("https://truelycollectables.com/api/instacomp/scan", {
    method: "POST",
    headers,
    body: "{}",
  });
}

const sameOriginAdmin = instaCompMutationSecurityDecision({
  request: request({ Origin: "https://truelycollectables.com" }),
  actor: adminActor,
  expectedServiceToken: serviceToken,
});
assert.equal(sameOriginAdmin.allowed, true);
assert.equal(sameOriginAdmin.channel, "admin_same_origin");

const rejectedAdminHeaders: Array<Record<string, string>> = [
  {},
  { Origin: "https://attacker.truelycollectables.com" },
  {
    Origin: "https://evil.example",
    "Sec-Fetch-Site": "cross-site",
  },
];

for (const headers of rejectedAdminHeaders) {
  const decision = instaCompMutationSecurityDecision({
    request: request(headers),
    actor: adminActor,
    expectedServiceToken: serviceToken,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.channel, null);
}

const sellerBearer = instaCompMutationSecurityDecision({
  request: request({ Authorization: "Bearer seller-jwt" }),
  actor: sellerActor,
  expectedServiceToken: serviceToken,
});
assert.equal(sellerBearer.allowed, true);
assert.equal(sellerBearer.channel, "seller_bearer");

const sellerCookieOnly = instaCompMutationSecurityDecision({
  request: request({ Cookie: "session=seller" }),
  actor: sellerActor,
  expectedServiceToken: serviceToken,
});
assert.equal(sellerCookieOnly.allowed, false);
assert.equal(sellerCookieOnly.code, "INSTACOMP_SELLER_BEARER_REQUIRED");

const service = instaCompMutationSecurityDecision({
  request: request({
    "x-tcos-instacomp-service-token": serviceToken,
  }),
  actor: adminActor,
  expectedServiceToken: serviceToken,
});
assert.equal(service.allowed, true);
assert.equal(service.channel, "service_token");

const wrongServiceActor = instaCompMutationSecurityDecision({
  request: request({
    "x-tcos-instacomp-service-token": serviceToken,
  }),
  actor: sellerActor,
  expectedServiceToken: serviceToken,
});
assert.equal(wrongServiceActor.allowed, false);
assert.equal(wrongServiceActor.code, "INSTACOMP_SERVICE_ACTOR_MISMATCH");

const wrongServiceToken = instaCompMutationSecurityDecision({
  request: request({
    "x-tcos-instacomp-service-token": `${serviceToken}-wrong`,
  }),
  actor: adminActor,
  expectedServiceToken: serviceToken,
});
assert.equal(wrongServiceToken.allowed, false);

assert.throws(
  () =>
    assertTrustedInstaCompMutationRequest({
      request: request(),
      actor: adminActor,
      expectedServiceToken: serviceToken,
    }),
  /same-origin request metadata/i,
);

console.log("InstaComp mutation authentication-channel regressions passed.");
