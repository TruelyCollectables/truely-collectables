import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getClientIdentity } from "../src/lib/client-identity";
import { getLivePaymentRuntimeGate } from "../src/lib/live-payment-launch";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
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

async function main() {
  try {
    process.env.TCOS_LIVE_PAYMENTS_ENABLED = "true";
    process.env.IP_INTELLIGENCE_REQUIRED = "false";
    delete process.env.IP_INTELLIGENCE_API_URL;

    const disabledGate = await getLivePaymentRuntimeGate({
      stripeKey: "sk_live_identity_gate_fixture",
      supabase: {} as never,
    });
    assert.equal(disabledGate.allowed, false);
    assert.equal(disabledGate.mode, "live");
    assert.match(
      String(disabledGate.reason),
      /identity and VPN intelligence enforcement/i,
      "Live runtime must fail closed when identity intelligence is disabled.",
    );

    process.env.IP_INTELLIGENCE_REQUIRED = "true";
    delete process.env.IP_INTELLIGENCE_API_URL;
    const missingProviderGate = await getLivePaymentRuntimeGate({
      stripeKey: "sk_live_identity_gate_fixture",
      supabase: {} as never,
    });
    assert.equal(missingProviderGate.allowed, false);
    assert.match(
      String(missingProviderGate.reason),
      /identity and VPN intelligence enforcement/i,
      "Live runtime must fail closed when the identity provider URL is missing.",
    );

    const testGate = await getLivePaymentRuntimeGate({
      stripeKey: "sk_test_identity_gate_fixture",
      supabase: {} as never,
    });
    assert.deepEqual(testGate, {
      allowed: true,
      mode: "test",
      reason: null,
    });

    process.env["NODE_ENV"] = "production";
    process.env.IP_INTELLIGENCE_REQUIRED = "true";
    delete process.env.IP_INTELLIGENCE_API_URL;
    const blockedIdentity = await getClientIdentity(
      new Request("https://truelycollectables.com/checkout", {
        headers: {
          "x-forwarded-for": "8.8.8.8",
          "user-agent": "identity-gate-simulation",
        },
      }),
    );
    assert.equal(blockedIdentity.blocked, true);
    assert.equal(blockedIdentity.blockReason, "ip_intelligence_not_configured");

    process.env.IP_INTELLIGENCE_REQUIRED = "false";
    const uncheckedIdentity = await getClientIdentity(
      new Request("https://truelycollectables.com/checkout", {
        headers: {
          "x-forwarded-for": "8.8.8.8",
          "user-agent": "identity-gate-simulation",
        },
      }),
    );
    assert.equal(uncheckedIdentity.blocked, false);
    assert.equal(uncheckedIdentity.risk, "unchecked");

    const coreSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/live-payment-launch-core.ts"),
      "utf8",
    );
    for (const fragment of [
      'case "identity_intelligence"',
      '"identity_intelligence",\n      "Identity And VPN Blocking"',
      "Live payments require configured identity and VPN intelligence enforcement.",
      "IP intelligence enforcement is disabled; live Checkout cannot be approved.",
    ]) {
      assert.ok(
        coreSource.includes(fragment),
        `Live-payment core is missing ${fragment}.`,
      );
    }
    const runtimeIdentityIndex = coreSource.indexOf(
      "const identityIntelligenceRequired =",
    );
    const runtimeSupabaseIndex = coreSource.indexOf(
      "const supabase =\n    params.supabase || createSupabaseServerClient",
    );
    assert.ok(
      runtimeIdentityIndex >= 0 &&
        runtimeSupabaseIndex >= 0 &&
        runtimeIdentityIndex < runtimeSupabaseIndex,
      "Live runtime must reject missing identity configuration before privileged database evaluation.",
    );

    const readinessSource = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/launch-readiness/page.tsx"),
      "utf8",
    );
    assert.ok(
      readinessSource.includes(
        "IP intelligence enforcement is disabled, so live Checkout remains blocked.",
      ),
      "Launch Readiness must show disabled identity intelligence as blocked.",
    );

    const auditSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/audit-vercel-production-environment.mjs",
      ),
      "utf8",
    );
    for (const name of [
      "IP_INTELLIGENCE_REQUIRED",
      "IP_INTELLIGENCE_API_URL",
    ]) {
      assert.ok(
        auditSource.includes(`"${name}"`),
        `Vercel Production environment audit must require ${name}.`,
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
      "Checkout must verify client identity before creating a Stripe Checkout Session.",
    );

    console.log(
      "Live-payment identity-gate simulations passed: live approval/runtime require identity intelligence, actual checkout identity fails closed, and test mode remains usable.",
    );
  } finally {
    restoreEnvironment();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
