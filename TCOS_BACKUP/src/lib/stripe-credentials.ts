function configured(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function matching(value: string | undefined, prefix: string) {
  const candidate = configured(value);
  return candidate?.startsWith(prefix) ? candidate : null;
}

export function getStripeTestSecretKey() {
  return (
    matching(process.env.STRIPE_TEST_SECRET_KEY, "sk_test_") ||
    matching(process.env.STRIPE_SECRET_KEY, "sk_test_")
  );
}

export function getStripeLiveSecretKey() {
  return (
    matching(process.env.STRIPE_LIVE_SECRET_KEY, "sk_live_") ||
    matching(process.env.STRIPE_SECRET_KEY, "sk_live_")
  );
}

export function getStripeTestPublishableKey() {
  return (
    matching(process.env.NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY, "pk_test_") ||
    matching(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, "pk_test_")
  );
}

export function getStripeLivePublishableKey() {
  return (
    matching(process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY, "pk_live_") ||
    matching(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, "pk_live_")
  );
}

export function getStripeTestWebhookSecret() {
  return (
    matching(process.env.STRIPE_TEST_WEBHOOK_SECRET, "whsec_") ||
    (matching(process.env.STRIPE_SECRET_KEY, "sk_test_")
      ? matching(process.env.STRIPE_WEBHOOK_SECRET, "whsec_")
      : null)
  );
}

export function getStripeLiveWebhookSecret() {
  return (
    matching(process.env.STRIPE_LIVE_WEBHOOK_SECRET, "whsec_") ||
    (matching(process.env.STRIPE_SECRET_KEY, "sk_live_")
      ? matching(process.env.STRIPE_WEBHOOK_SECRET, "whsec_")
      : null)
  );
}

export function getOperationalStripeSecretKey() {
  return process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true"
    ? getStripeLiveSecretKey()
    : getStripeTestSecretKey();
}

export function configuredStripeMode() {
  if (process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true") {
    return getStripeLiveSecretKey() ? "live" : "missing";
  }
  return getStripeTestSecretKey() ? "test" : "missing";
}
