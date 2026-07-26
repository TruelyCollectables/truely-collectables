import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getClientIdentity } from "../src/lib/client-identity";
import { getLivePaymentRuntimeGate } from "../src/lib/live-payment-launch";

const originalEnvironment = {
  TCOS_LIVE_PAYMENTS_ENABLED: process.env.TCOS_LIVE_PAYMENTS_ENABLED,
  IP_INTELLIGENCE_REQUIRED: process.env.IP_INTELLIGENCE_REQUIRED,
  IP_INTELLIGENCE_API_URL: process.env.IP_INTELLIGENCE_API_URL,
};

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function fakeApprovedSupabase() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: async () =>
          table === "live_payment_launch_gates"
            ? {
                data: {
                  gate_status: "approved",
                  approval_version: "tcos-live-payments-v1",
                },
                error: null,
              }
            : { data: null, error: null },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      });
      return builder;
    },
  } as never;
}

async function main() {
  try {
    process.env.TCOS_LIVE_PAYMENTS_ENABLED = "true";
    process.env.IP_INTELLIGENCE_REQUIRED = "false";
    delete process.env.IP_INTELLIGENCE_API_URL;

    const storefrontGate = await getLivePaymentRuntimeGate({
      stripeKey: "sk_live_storefront_scope_fixture",
      supabase: fakeApprovedSupabase(),
    });
    assert.deepEqual(storefrontGate, {
      allowed: true,
      mode: "live",
      reason: null,
    });

    const optionalIdentity = await getClientIdentity(
      new Request("https://truelycollectables.com/checkout", {
        headers: {
          "x-forwarded-for": "8.8.8.8",
          "user-agent": "storefront-identity-scope-simulation",
        },
      }),
    );
    assert.equal(optionalIdentity.blocked, false);
    assert.equal(optionalIdentity.risk, "unchecked");

    process.env.IP_INTELLIGENCE_REQUIRED = "true";
    delete process.env.IP_INTELLIGENCE_API_URL;
    const optedInButMisconfigured = await getClientIdentity(
      new Request("https://truelycollectables.com/checkout", {
        headers: {
          "x-forwarded-for": "8.8.8.8",
          "user-agent": "storefront-identity-scope-simulation",
        },
      }),
    );
    assert.equal(optedInButMisconfigured.blocked, true);
    assert.equal(
      optedInButMisconfigured.blockReason,
      "ip_intelligence_not_configured",
    );

    const coreSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/live-payment-launch-core.ts"),
      "utf8",
    );
    assert.ok(
      !coreSource.includes(
        "Live payments require configured identity and VPN intelligence enforcement.",
      ),
      "Truely Collectables live-payment runtime must not require TCOS VPN intelligence.",
    );
    assert.ok(
      coreSource.includes("Optional TCOS Identity And VPN Intelligence"),
      "The optional TCOS hardening check must remain visible without becoming a storefront blocker.",
    );
    assert.ok(
      coreSource.includes(
        "does not block the Truely Collectables sports-card storefront",
      ),
      "The live-payment report must state the storefront scope explicitly.",
    );

    const readinessSource = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/launch-readiness/page.tsx"),
      "utf8",
    );
    assert.ok(
      readinessSource.includes(
        "not a Truely Collectables storefront launch requirement",
      ),
      "Launch Readiness must classify VPN intelligence as post-launch TCOS hardening.",
    );

    const auditSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/audit-vercel-production-environment.mjs",
      ),
      "utf8",
    );
    const requiredList = auditSource.slice(
      auditSource.indexOf("const requiredProductionKeys"),
      auditSource.indexOf("]);", auditSource.indexOf("const requiredProductionKeys")) + 3,
    );
    for (const name of [
      "IP_INTELLIGENCE_REQUIRED",
      "IP_INTELLIGENCE_API_URL",
    ]) {
      assert.ok(
        !requiredList.includes(name),
        `Vercel storefront launch audit must not require ${name}.`,
      );
    }

    const checkoutSource = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/checkout/route.ts"),
      "utf8",
    );
    const identityCheckIndex = checkoutSource.indexOf(
      "await checkPublicEndpointRateLimit",
    );
    const stripeCreateIndex = checkoutSource.indexOf(
      "stripe.checkout.sessions.create",
    );
    assert.ok(
      identityCheckIndex >= 0 &&
        stripeCreateIndex >= 0 &&
        identityCheckIndex < stripeCreateIndex,
      "Checkout must retain rate limiting and identity evidence before creating a Stripe Checkout Session.",
    );

    console.log(
      "Storefront identity-scope simulations passed: VPN/proxy intelligence is optional TCOS hardening, Truely Collectables live Checkout is not blocked when it is disabled, opt-in misconfiguration still fails closed, and checkout rate limiting remains enforced.",
    );
  } finally {
    restoreEnvironment();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
