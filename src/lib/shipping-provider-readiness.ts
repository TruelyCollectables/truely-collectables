import { getShippingProviderAdapterProfile } from "./shipping-provider-adapter";

export type ShippingProviderReadinessStatus = "ready" | "warning" | "blocked";

export type ShippingProviderReadinessItem = {
  key: string;
  label: string;
  status: ShippingProviderReadinessStatus;
  detail: string;
  action: string;
  missing: string[];
};

function providerRequired() {
  return process.env.TCOS_SHIPPING_PROVIDERS_REQUIRED === "true";
}

function missingStatus(missing: string[]) {
  if (missing.length === 0) return "ready" as const;

  return providerRequired() ? ("blocked" as const) : ("warning" as const);
}

function shippingPurchaseMode() {
  return process.env.TCOS_SHIPPING_PURCHASE_MODE === "live" ? "live" : "dry_run";
}

export function getShippingProviderReadiness(): ShippingProviderReadinessItem[] {
  const purchaseMode = shippingPurchaseMode();
  const standardEnvelopeProfile =
    getShippingProviderAdapterProfile("STANDARD_ENVELOPE");
  const parcelProfile = getShippingProviderAdapterProfile("GROUND_ADVANTAGE");
  const coverageMissing = standardEnvelopeProfile.missingCoverageCredentialKeys;

  return [
    {
      key: "shipping_purchase_mode",
      label: "Shipping Purchase Mode",
      status: purchaseMode === "live" ? "blocked" : "warning",
      detail:
        purchaseMode === "live"
          ? "Live shipping purchase mode is enabled, but TCOS has not approved a live postage provider adapter yet."
          : "TCOS is in dry-run shipping purchase mode. Adapter attempts simulate label, tracking, postage, and Coverage policy records without buying postage.",
      action:
        purchaseMode === "live"
          ? "Switch TCOS_SHIPPING_PURCHASE_MODE back to dry_run until a live provider adapter is approved."
          : "Keep dry_run for testing. Move to live only after provider credentials, contracts, label voiding, and reconciliation are approved.",
      missing: purchaseMode === "live" ? ["approved live shipping adapter"] : [],
    },
    {
      key: "shipping_adapter_contract",
      label: "Shipping Adapter Contract",
      status: purchaseMode === "live" ? "blocked" : "warning",
      detail:
        purchaseMode === "live"
          ? "TCOS has an auditable adapter contract, but live provider execution is intentionally blocked until a real adapter is implemented and approved."
          : "TCOS currently exposes a dry-run adapter contract and manual external-purchase recording. No live postage or Coverage API is called from TCOS.",
      action:
        "Keep live purchase disabled until the chosen provider adapter supports quotes, buys, voids, Coverage purchase, webhook reconciliation, and audit packets end-to-end.",
      missing: purchaseMode === "live" ? ["approved live adapter implementation"] : [],
    },
    {
      key: "standard_envelope_provider",
      label: "Standard Envelope Provider",
      status: missingStatus(standardEnvelopeProfile.missingCredentialKeys),
      detail:
        standardEnvelopeProfile.missingCredentialKeys.length === 0
          ? `${standardEnvelopeProfile.provider} is configured for TCOS Standard Envelope / IMb shipping.`
          : "TCOS can price and audit Standard Envelope orders, and can export a LetterTrack import CSV, but cannot treat the lane as operational until the LetterTrack account/import workflow or a future IMb API provider is approved.",
      action:
        standardEnvelopeProfile.missingCredentialKeys.length === 0
          ? "Use the LetterTrack export from the shipping cockpit, then record assigned IMb references back into TCOS."
          : `Set ${standardEnvelopeProfile.missingCredentialKeys.join(", ")} in production secrets.`,
      missing: standardEnvelopeProfile.missingCredentialKeys,
    },
    {
      key: "parcel_label_provider",
      label: "Ground Advantage / Priority Label Provider",
      status: missingStatus(parcelProfile.missingCredentialKeys),
      detail:
        parcelProfile.missingCredentialKeys.length === 0
          ? `${parcelProfile.provider} is configured for USPS parcel label purchase.`
          : "TCOS can require Ground Advantage/Priority and record tracking, but cannot buy parcel labels until a provider key is configured.",
      action:
        parcelProfile.missingCredentialKeys.length === 0
          ? "Wire the parcel-label purchase adapter into the order shipping cockpit."
          : `Set ${parcelProfile.missingCredentialKeys.join(", ")} in production secrets.`,
      missing: parcelProfile.missingCredentialKeys,
    },
    {
      key: "shipping_coverage_provider",
      label: "Shipping Coverage Provider",
      status: missingStatus(coverageMissing),
      detail:
        coverageMissing.length === 0
          ? `${standardEnvelopeProfile.coverageProvider} is configured for seller shipment coverage purchase.`
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

export function shippingPurchaseBlockers(params: {
  method: string | null | undefined;
  readiness?: ShippingProviderReadinessItem[];
}) {
  const readiness = params.readiness || getShippingProviderReadiness();
  const method = params.method || "GROUND_ADVANTAGE";
  const neededKeys = new Set<string>(["shipping_coverage_provider"]);

  if (method === "STANDARD_ENVELOPE") {
    neededKeys.add("standard_envelope_provider");
  } else {
    neededKeys.add("parcel_label_provider");
  }

  const purchaseMode = readiness.find(
    (item) => item.key === "shipping_purchase_mode",
  );
  if (purchaseMode?.status === "blocked") {
    neededKeys.add("shipping_purchase_mode");
  }

  return readiness.filter(
    (item) => neededKeys.has(item.key) && item.status !== "ready",
  );
}
