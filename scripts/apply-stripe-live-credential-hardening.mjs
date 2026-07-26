import fs from "node:fs";

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected Stripe live-credential fragment was not found in ${path}.`);
  }
  const next = source.replace(before, after);
  if (next === source) {
    throw new Error(`Stripe live-credential hardening made no change in ${path}.`);
  }
  fs.writeFileSync(path, next, "utf8");
}

replaceExact(
  "src/lib/stripe-credentials.ts",
  `export function getStripeLiveSecretKey() {
  return (
    matching(process.env.STRIPE_LIVE_SECRET_KEY, "sk_live_") ||
    matching(process.env.STRIPE_SECRET_KEY, "sk_live_")
  );
}`,
  `export function getStripeLiveSecretKey() {
  return matching(process.env.STRIPE_LIVE_SECRET_KEY, "sk_live_");
}`,
);

replaceExact(
  "src/lib/stripe-credentials.ts",
  `export function getStripeLivePublishableKey() {
  return (
    matching(process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY, "pk_live_") ||
    matching(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, "pk_live_")
  );
}`,
  `export function getStripeLivePublishableKey() {
  return matching(
    process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY,
    "pk_live_",
  );
}`,
);

replaceExact(
  "src/lib/stripe-credentials.ts",
  `export function getStripeLiveWebhookSecret() {
  return (
    matching(process.env.STRIPE_LIVE_WEBHOOK_SECRET, "whsec_") ||
    (matching(process.env.STRIPE_SECRET_KEY, "sk_live_")
      ? matching(process.env.STRIPE_WEBHOOK_SECRET, "whsec_")
      : null)
  );
}`,
  `export function getStripeLiveWebhookSecret() {
  return matching(process.env.STRIPE_LIVE_WEBHOOK_SECRET, "whsec_");
}`,
);

replaceExact(
  "scripts/status-live-money.ts",
  `function liveSecretStatus(
  primary: string | undefined,
  fallback: string | undefined,
  prefix: string,
) {
  if (hasPrefix(primary, prefix)) return "configured";
  if (hasPrefix(fallback, prefix)) return "configured via fallback";
  if (configured(primary) || configured(fallback)) {
    return "present but not live-shaped";
  }
  return "missing";
}`,
  `function liveSecretStatus(value: string | undefined, prefix: string) {
  if (hasPrefix(value, prefix)) return "configured";
  if (configured(value)) return "present but not live-shaped";
  return "missing";
}`,
);

replaceExact(
  "scripts/status-live-money.ts",
  `        status: liveSecretStatus(
          process.env.STRIPE_LIVE_SECRET_KEY,
          process.env.STRIPE_SECRET_KEY,
          "sk_live_",
        ),`,
  `        status: liveSecretStatus(
          process.env.STRIPE_LIVE_SECRET_KEY,
          "sk_live_",
        ),`,
);

replaceExact(
  "scripts/status-live-money.ts",
  `        status: liveSecretStatus(
          process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY,
          process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
          "pk_live_",
        ),`,
  `        status: liveSecretStatus(
          process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY,
          "pk_live_",
        ),`,
);

replaceExact(
  "scripts/status-live-money.ts",
  `        status: liveSecretStatus(
          process.env.STRIPE_LIVE_WEBHOOK_SECRET,
          process.env.STRIPE_WEBHOOK_SECRET,
          "whsec_",
        ),`,
  `        status: liveSecretStatus(
          process.env.STRIPE_LIVE_WEBHOOK_SECRET,
          "whsec_",
        ),`,
);

replaceExact(
  "scripts/live-money-env-packet.mjs",
  `    note: "Live Stripe secret key. Prefer this live-suffixed name over unsuffixed compatibility fallbacks.",`,
  `    note: "Dedicated live Stripe secret key. This exact variable is required; generic Stripe variables are not accepted for live Checkout.",`,
);

console.log(
  "Applied fail-closed dedicated Stripe live credential selection and operator guidance.",
);
