import assert from "node:assert/strict";
import { POST } from "../src/app/api/internal/instacomp-seller-sweep-live-verify/route";

const endpoint =
  "https://truelycollectables.com/api/internal/instacomp-seller-sweep-live-verify";
const headerName = "x-instacomp-seller-sweep-live-verify";
const sweepId = "00000000-0000-4000-8000-000000000001";
const originalFetch = globalThis.fetch;
const originalVerifierSecret =
  process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET;
const originalAdminSessionSecret = process.env.ADMIN_SESSION_SECRET;

function verifierRequest(secret: string, body: Record<string, unknown>) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [headerName]: secret,
    },
    body: JSON.stringify(body),
  });
}

function requestHeaders(init?: RequestInit) {
  return new Headers(init?.headers);
}

async function responseBody(response: Response) {
  return (await response.json()) as {
    ok?: boolean;
    action?: string;
    error?: string;
    result?: Record<string, unknown>;
  };
}

async function main() {
  try {
    process.env.ADMIN_SESSION_SECRET = "seller-sweep-test-session-secret";

    delete process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET;
    let response = await POST(
      verifierRequest("missing", { action: "workbench" }),
    );
    assert.equal(response.status, 401);

    const expiredSecret = `${Math.floor(Date.now() / 1000) - 1}.expired`;
    process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET = expiredSecret;
    response = await POST(
      verifierRequest(expiredSecret, { action: "workbench" }),
    );
    assert.equal(response.status, 401);

    const activeSecret = `${Math.floor(Date.now() / 1000) + 600}.active-secret`;
    process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET = activeSecret;

    const protectedRequests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      protectedRequests.push({ url: String(input), init });
      return new Response("<main>Seller Sweep</main>", { status: 200 });
    }) as typeof fetch;
    response = await POST(
      verifierRequest(activeSecret, { action: "workbench" }),
    );
    assert.equal(response.status, 200);
    assert.equal((await responseBody(response)).result?.available, true);
    const workbenchRequest = protectedRequests.at(-1);
    assert.ok(workbenchRequest);
    assert.match(workbenchRequest.url, /\/admin\/instacomp\/seller-sweep/);
    assert.match(
      requestHeaders(workbenchRequest.init).get("cookie") || "",
      /^tcos_admin_auth_v3=/,
    );
    assert.equal(
      requestHeaders(workbenchRequest.init).get("origin"),
      null,
      "Safe workbench GET should not claim a mutation Origin",
    );
    assert.equal(response.headers.get("set-cookie"), null);

    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      protectedRequests.push({ url: String(input), init });
      return Response.json({
        sweepId,
        listingLimit: 1,
        total: 1,
        photosReady: 1,
      });
    }) as typeof fetch;
    response = await POST(
      verifierRequest(activeSecret, { action: "collect", queryIndex: 1 }),
    );
    assert.equal(response.status, 200);
    assert.equal((await responseBody(response)).action, "collect");
    const collectRequest = protectedRequests.at(-1);
    assert.ok(collectRequest);
    const collectBody = JSON.parse(String(collectRequest.init?.body));
    assert.deepEqual(collectBody, {
      sellerUrl: "https://www.ebay.com/str/missmelscards",
      query: "sports card",
      limit: 1,
    });
    assert.equal(
      requestHeaders(collectRequest.init).get("origin"),
      "https://truelycollectables.com",
      "Protected collect POST must prove its exact origin",
    );
    assert.match(
      requestHeaders(collectRequest.init).get("cookie") || "",
      /^tcos_admin_auth_v3=/,
    );

    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      protectedRequests.push({ url: String(input), init });
      return Response.json({ processedThisRun: 1, remaining: 0 });
    }) as typeof fetch;
    response = await POST(
      verifierRequest(activeSecret, { action: "process", sweepId }),
    );
    assert.equal(response.status, 200);
    const processRequest = protectedRequests.at(-1);
    assert.ok(processRequest);
    assert.match(processRequest.url, /seller-sweep\/process$/);
    assert.deepEqual(JSON.parse(String(processRequest.init?.body)), {
      sweepId,
      batchSize: 1,
    });
    assert.equal(
      requestHeaders(processRequest.init).get("origin"),
      "https://truelycollectables.com",
      "Protected process POST must prove its exact origin",
    );

    let unexpectedFetch = false;
    globalThis.fetch = (async () => {
      unexpectedFetch = true;
      return Response.json({});
    }) as typeof fetch;
    response = await POST(
      verifierRequest(activeSecret, { action: "collect", queryIndex: 99 }),
    );
    assert.equal(response.status, 500);
    assert.match((await responseBody(response)).error || "", /bounded ladder/);
    assert.equal(unexpectedFetch, false);

    response = await POST(
      verifierRequest(activeSecret, { action: "publish", sweepId }),
    );
    assert.equal(response.status, 500);
    assert.match((await responseBody(response)).error || "", /Unsupported/);
    assert.equal(unexpectedFetch, false);

    console.log("Seller Sweep scoped live-verifier simulations passed.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVerifierSecret === undefined) {
      delete process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET;
    } else {
      process.env.INSTACOMP_SELLER_SWEEP_LIVE_VERIFY_SECRET =
        originalVerifierSecret;
    }
    if (originalAdminSessionSecret === undefined) {
      delete process.env.ADMIN_SESSION_SECRET;
    } else {
      process.env.ADMIN_SESSION_SECRET = originalAdminSessionSecret;
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
