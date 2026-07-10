export type ShippingProviderReadinessStatus = "ready" | "warning" | "blocked";

export type ShippingProviderReadinessItem = {
  key: string;
  label: string;
  status: ShippingProviderReadinessStatus;
  detail: string;
  action: string;
  missing: string[];
};

function configured(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function providerRequired() {
  return process.env.TCOS_SHIPPING_PROVIDERS_REQUIRED === "true";
}

function missingStatus(missing: string[]) {
  if (missing.length === 0) return "ready" as const;

  return providerRequired() ? ("blocked" as const) : ("warning" as const);
}

function configuredProvider(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export function getShippingProviderReadiness(): ShippingProviderReadinessItem[] {
  const standardEnvelopeProvider = configuredProvider(
    process.env.TCOS_STANDARD_ENVELOPE_PROVIDER,
    "IMb envelope provider",
  );
  const parcelProvider = configuredProvider(
    process.env.TCOS_PARCEL_LABEL_PROVIDER,
    configured(process.env.EASYPOST_API_KEY)
      ? "EasyPost"
      : configured(process.env.SHIPPO_API_TOKEN)
        ? "Shippo"
        : "parcel label provider",
  );
  const coverageProvider = configuredProvider(
    process.env.TCOS_SHIPPING_COVERAGE_PROVIDER,
    "Coverage",
  );

  const standardEnvelopeMissing = [
    !configured(process.env.TCOS_STANDARD_ENVELOPE_PROVIDER)
      ? "TCOS_STANDARD_ENVELOPE_PROVIDER"
      : null,
    !configured(process.env.TCOS_STANDARD_ENVELOPE_API_KEY) &&
    !configured(process.env.IMB_PROVIDER_API_KEY)
      ? "TCOS_STANDARD_ENVELOPE_API_KEY or IMB_PROVIDER_API_KEY"
      : null,
  ].filter((value): value is string => Boolean(value));

  const parcelMissing = [
    !configured(process.env.TCOS_PARCEL_LABEL_PROVIDER) &&
    !configured(process.env.EASYPOST_API_KEY) &&
    !configured(process.env.SHIPPO_API_TOKEN)
      ? "TCOS_PARCEL_LABEL_PROVIDER plus EASYPOST_API_KEY or SHIPPO_API_TOKEN"
      : null,
  ].filter((value): value is string => Boolean(value));

  const coverageMissing = [
    !configured(process.env.TCOS_SHIPPING_COVERAGE_PROVIDER)
      ? "TCOS_SHIPPING_COVERAGE_PROVIDER"
      : null,
    !configured(process.env.TCOS_SHIPPING_COVERAGE_API_KEY) &&
    !configured(process.env.COVERAGE_API_KEY)
      ? "TCOS_SHIPPING_COVERAGE_API_KEY or COVERAGE_API_KEY"
      : null,
  ].filter((value): value is string => Boolean(value));

  return [
    {
      key: "standard_envelope_provider",
      label: "Standard Envelope Provider",
      status: missingStatus(standardEnvelopeMissing),
      detail:
        standardEnvelopeMissing.length === 0
          ? `${standardEnvelopeProvider} is configured for TCOS Standard Envelope / IMb shipping.`
          : "TCOS can price and audit Standard Envelope orders, but cannot buy real IMb envelope labels until the provider account is configured.",
      action:
        standardEnvelopeMissing.length === 0
          ? "Wire the provider purchase adapter into the order shipping cockpit."
          : `Set ${standardEnvelopeMissing.join(", ")} in production secrets.`,
      missing: standardEnvelopeMissing,
    },
    {
      key: "parcel_label_provider",
      label: "Ground Advantage / Priority Label Provider",
      status: missingStatus(parcelMissing),
      detail:
        parcelMissing.length === 0
          ? `${parcelProvider} is configured for USPS parcel label purchase.`
          : "TCOS can require Ground Advantage/Priority and record tracking, but cannot buy parcel labels until a provider key is configured.",
      action:
        parcelMissing.length === 0
          ? "Wire the parcel-label purchase adapter into the order shipping cockpit."
          : `Set ${parcelMissing.join(", ")} in production secrets.`,
      missing: parcelMissing,
    },
    {
      key: "shipping_coverage_provider",
      label: "Shipping Coverage Provider",
      status: missingStatus(coverageMissing),
      detail:
        coverageMissing.length === 0
          ? `${coverageProvider} is configured for seller shipment coverage purchase.`
          : "TCOS marks every shipment as coverage-required, but cannot purchase external seller protection until the coverage provider account is configured.",
      action:
        coverageMissing.length === 0
          ? "Wire the coverage purchase adapter into label purchase."
          : `Set ${coverageMissing.join(", ")} in production secrets.`,
      missing: coverageMissing,
    },
  ];
}

export function shippingProviderSummary(items = getShippingProviderReadiness()) {
  return {
    ready: items.filter((item) => item.status === "ready").length,
    warning: items.filter((item) => item.status === "warning").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}
