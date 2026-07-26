from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file_path.write_text(source.replace(old, new), encoding="utf-8")


replace_exact(
    "src/lib/live-payment-launch-core.ts",
    '''    case "identity_intelligence":
      return "Set IP_INTELLIGENCE_REQUIRED=true and configure IP_INTELLIGENCE_API_URL before approving live Checkout.";
''',
    '''    case "identity_intelligence":
      return "Defer VPN/proxy intelligence to the post-launch TCOS security roadmap; it is not required for the Truely Collectables storefront launch.";
''',
)

replace_exact(
    "src/lib/live-payment-launch-core.ts",
    '''  const identityIntelligenceRequired =
    process.env.IP_INTELLIGENCE_REQUIRED === "true";
  const identityIntelligenceProviderConfigured = Boolean(
    process.env.IP_INTELLIGENCE_API_URL?.trim(),
  );
  if (!identityIntelligenceRequired || !identityIntelligenceProviderConfigured) {
    return {
      allowed: false,
      mode: "live" as const,
      reason:
        "Live payments require configured identity and VPN intelligence enforcement.",
    };
  }

''',
    '',
)

replace_exact(
    "src/lib/live-payment-launch-core.ts",
    '''  const identityIntelligenceRequired =
    process.env.IP_INTELLIGENCE_REQUIRED === "true";
  const identityIntelligenceProviderConfigured = Boolean(
    process.env.IP_INTELLIGENCE_API_URL?.trim(),
  );
  checks.push(
    check(
      "identity_intelligence",
      "Identity And VPN Blocking",
      identityIntelligenceRequired && identityIntelligenceProviderConfigured
        ? "passed"
        : "blocked",
      identityIntelligenceRequired && identityIntelligenceProviderConfigured
        ? "IP intelligence is required and a provider URL is configured for live Checkout."
        : identityIntelligenceRequired
          ? "IP_INTELLIGENCE_REQUIRED is true, but IP_INTELLIGENCE_API_URL is missing."
          : "IP intelligence enforcement is disabled; live Checkout cannot be approved.",
    ),
  );
''',
    '''  const identityIntelligenceRequired =
    process.env.IP_INTELLIGENCE_REQUIRED === "true";
  const identityIntelligenceProviderConfigured = Boolean(
    process.env.IP_INTELLIGENCE_API_URL?.trim(),
  );
  checks.push(
    check(
      "identity_intelligence",
      "Optional TCOS Identity And VPN Intelligence",
      identityIntelligenceRequired
        ? identityIntelligenceProviderConfigured
          ? "passed"
          : "blocked"
        : "warning",
      identityIntelligenceRequired && identityIntelligenceProviderConfigured
        ? "Optional TCOS identity intelligence is configured. It is not required for the Truely Collectables storefront launch."
        : identityIntelligenceRequired
          ? "IP_INTELLIGENCE_REQUIRED is true, but IP_INTELLIGENCE_API_URL is missing. Disable the optional feature or configure it before Checkout."
          : "VPN/proxy intelligence belongs to the post-launch TCOS security roadmap and does not block the Truely Collectables sports-card storefront.",
    ),
  );
''',
)

replace_exact(
    "src/app/admin/launch-readiness/page.tsx",
    '''    {
      label: "Identity And VPN Blocking",
      status:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "ready"
          : "blocked",
      detail:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "IP intelligence is required and configured for live Checkout."
          : identityRequired
            ? "IP_INTELLIGENCE_REQUIRED is true, but IP_INTELLIGENCE_API_URL is missing."
            : "IP intelligence enforcement is disabled, so live Checkout remains blocked.",
      action:
        "Set IP_INTELLIGENCE_REQUIRED=true and configure IP_INTELLIGENCE_API_URL before launch.",
    },
''',
    '''    {
      label: "Optional TCOS Identity And VPN Intelligence",
      status:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "ready"
          : identityRequired
            ? "blocked"
            : "warning",
      detail:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "Optional TCOS identity intelligence is configured. It is not required for the Truely Collectables storefront launch."
          : identityRequired
            ? "IP_INTELLIGENCE_REQUIRED is true, but IP_INTELLIGENCE_API_URL is missing. Disable the optional feature or configure it before Checkout."
            : "VPN/proxy intelligence is deferred to the post-launch TCOS security roadmap and does not block the Truely Collectables sports-card storefront.",
      action:
        "Treat this as optional post-launch TCOS hardening, not a Truely Collectables storefront launch requirement.",
    },
''',
)

replace_exact(
    "scripts/audit-vercel-production-environment.mjs",
    '''  "ADMIN_SESSION_SECRET",
  "IP_INTELLIGENCE_REQUIRED",
  "IP_INTELLIGENCE_API_URL",
  "STRIPE_LIVE_SECRET_KEY",
''',
    '''  "ADMIN_SESSION_SECRET",
  "STRIPE_LIVE_SECRET_KEY",
''',
)

Path("scripts/run-live-payment-identity-gate-simulations.ts").write_text(
    '''import assert from "node:assert/strict";
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
''',
    encoding="utf-8",
)

replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "name: Live Payment Identity Gate\n",
    "name: Storefront Identity Scope Gate\n",
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "  live-payment-identity-gate:\n",
    "  storefront-identity-scope-gate:\n",
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    '''      IP_INTELLIGENCE_REQUIRED: "true"
      IP_INTELLIGENCE_API_URL: https://identity.example.invalid/{ip}
''',
    '''      IP_INTELLIGENCE_REQUIRED: "false"
''',
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "      - name: Validate live-payment identity lock\n",
    "      - name: Validate storefront identity scope\n",
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "        run: node --import tsx scripts/run-live-payment-identity-gate-simulations.ts > live-payment-identity-gate.log 2>&1\n",
    "        run: node --import tsx scripts/run-live-payment-identity-gate-simulations.ts > storefront-identity-scope-gate.log 2>&1\n",
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "      - name: Upload live-payment identity evidence\n",
    "      - name: Upload storefront identity-scope evidence\n",
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    '''          name: live-payment-identity-gate-evidence
          path: live-payment-identity-gate.log
''',
    '''          name: storefront-identity-scope-gate-evidence
          path: storefront-identity-scope-gate.log
''',
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "      - name: Enforce live-payment identity lock\n",
    "      - name: Enforce storefront identity scope\n",
)
replace_exact(
    ".github/workflows/live-payment-identity-gate.yml",
    "          cat live-payment-identity-gate.log\n",
    "          cat storefront-identity-scope-gate.log\n",
)

print("Storefront identity scope correction applied.")
