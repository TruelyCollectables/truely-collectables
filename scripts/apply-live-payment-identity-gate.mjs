import fs from "node:fs";

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected identity-gate fragment was not found in ${path}.`);
  }
  const next = source.replace(before, after);
  if (next === source) {
    throw new Error(`Identity-gate hardening made no change in ${path}.`);
  }
  fs.writeFileSync(path, next, "utf8");
}

replaceExact(
  "src/lib/live-payment-launch-core.ts",
  `    case "production_origin":
      return "Set NEXT_PUBLIC_SITE_URL or the store primary domain to the HTTPS production origin.";
    case "platform_fee":`,
  `    case "production_origin":
      return "Set NEXT_PUBLIC_SITE_URL or the store primary domain to the HTTPS production origin.";
    case "identity_intelligence":
      return "Set IP_INTELLIGENCE_REQUIRED=true and configure IP_INTELLIGENCE_API_URL before approving live Checkout.";
    case "platform_fee":`,
);

replaceExact(
  "src/lib/live-payment-launch-core.ts",
  `  if (process.env.TCOS_LIVE_PAYMENTS_ENABLED !== "true") {
    return {
      allowed: false,
      mode: "live" as const,
      reason: "Live payments are administratively locked.",
    };
  }

  const supabase =`,
  `  if (process.env.TCOS_LIVE_PAYMENTS_ENABLED !== "true") {
    return {
      allowed: false,
      mode: "live" as const,
      reason: "Live payments are administratively locked.",
    };
  }

  const identityIntelligenceRequired =
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

  const supabase =`,
);

replaceExact(
  "src/lib/live-payment-launch-core.ts",
  `  checks.push(
    check(
      "production_origin",
      "HTTPS Production Origin",
      origin ? "passed" : "blocked",
      origin
        ? \`The expected payment origin is \${origin}.\`
        : "A valid HTTPS NEXT_PUBLIC_SITE_URL or primary store domain is required.",
    ),
  );

  const feeRate = Number(storeSettings.sellerCommissionRate || 0);`,
  `  checks.push(
    check(
      "production_origin",
      "HTTPS Production Origin",
      origin ? "passed" : "blocked",
      origin
        ? \`The expected payment origin is \${origin}.\`
        : "A valid HTTPS NEXT_PUBLIC_SITE_URL or primary store domain is required.",
    ),
  );

  const identityIntelligenceRequired =
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

  const feeRate = Number(storeSettings.sellerCommissionRate || 0);`,
);

replaceExact(
  "src/app/admin/launch-readiness/page.tsx",
  `    {
      label: "Identity And VPN Blocking",
      status:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "ready"
          : identityRequired
          ? "blocked"
          : "warning",
      detail:
        identityRequired && isConfigured(process.env.IP_INTELLIGENCE_API_URL)
          ? "IP intelligence is required and configured."
          : identityRequired
          ? "IP_INTELLIGENCE_REQUIRED is true, but IP_INTELLIGENCE_API_URL is missing."
          : "IP intelligence is not required.",
      action:
        "For launch, keep IP_INTELLIGENCE_REQUIRED=true and configure the provider URL/API key.",
    },`,
  `    {
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
    },`,
);

replaceExact(
  "scripts/audit-vercel-production-environment.mjs",
  `  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "STRIPE_LIVE_SECRET_KEY",`,
  `  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "IP_INTELLIGENCE_REQUIRED",
  "IP_INTELLIGENCE_API_URL",
  "STRIPE_LIVE_SECRET_KEY",`,
);

console.log(
  "Applied identity and VPN intelligence as a live-payment approval and runtime gate.",
);
