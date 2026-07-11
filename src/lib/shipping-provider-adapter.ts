import {
  getShippingCoverage,
  isShippingMethod,
  standardEnvelopeRateForEstimatedOunces,
  type ShippingMethod,
} from "./shipping";

export type ShippingProviderPurchaseMode = "dry_run" | "live";

export type ShippingProviderCredentialStatus = "configured" | "missing";

export type ShippingProviderAdapterProfile = {
  method: ShippingMethod;
  purchaseMode: ShippingProviderPurchaseMode;
  provider: string;
  providerService: string;
  carrier: string;
  adapterKey: string;
  adapterStatus: "dry_run_only" | "live_blocked";
  livePurchaseSupported: boolean;
  liveBlockReason: string | null;
  credentialKeys: string[];
  configuredCredentialKeys: string[];
  missingCredentialKeys: string[];
  credentialStatus: ShippingProviderCredentialStatus;
  coverageProvider: string;
  coverageCredentialKeys: string[];
  configuredCoverageCredentialKeys: string[];
  missingCoverageCredentialKeys: string[];
  coverageCredentialStatus: ShippingProviderCredentialStatus;
  manualPurchaseRequired: boolean;
};

export type ShippingProviderPurchaseRequest = {
  orderId: number;
  labelId: string;
  method: string | null | undefined;
  carrier: string | null | undefined;
  subtotal: number;
  shippingAmount: number;
  itemCount: number;
  standardEnvelopeEstimatedOunces?: number | null;
};

export type ShippingProviderPurchaseResult = {
  mode: ShippingProviderPurchaseMode;
  provider: string;
  providerService: string;
  providerLabelId: string;
  providerShipmentId: string;
  carrier: string;
  trackingNumber: string;
  postageAmount: number;
  labelUrl: string | null;
  labelPdfUrl: string | null;
  labelStatus: "purchased" | "printed";
  coverageProvider: string;
  coveragePolicyId: string;
  coverageAmount: number;
  coverageStatus: "covered";
  message: string;
  rawProviderPayload: Record<string, unknown>;
};

function purchaseMode(): ShippingProviderPurchaseMode {
  return process.env.TCOS_SHIPPING_PURCHASE_MODE === "live"
    ? "live"
    : "dry_run";
}

function safeMethod(value: string | null | undefined): ShippingMethod {
  return isShippingMethod(value) ? value : "GROUND_ADVANTAGE";
}

function suffix(input: string) {
  return input.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase() || "LABEL";
}

function providerForMethod(method: ShippingMethod) {
  if (method === "STANDARD_ENVELOPE") {
    return process.env.TCOS_STANDARD_ENVELOPE_PROVIDER || "TCOS Dry-Run IMb";
  }

  return (
    process.env.TCOS_PARCEL_LABEL_PROVIDER ||
    (process.env.EASYPOST_API_KEY ? "EasyPost" : null) ||
    (process.env.SHIPPO_API_TOKEN ? "Shippo" : null) ||
    "TCOS Dry-Run Parcel"
  );
}

function serviceForMethod(method: ShippingMethod) {
  if (method === "STANDARD_ENVELOPE") return "TCOS Standard Envelope";
  if (method === "PRIORITY_MAIL") return "USPS Priority Mail";
  return "USPS Ground Advantage";
}

function carrierForMethod(method: ShippingMethod, fallback?: string | null) {
  if (fallback?.trim()) return fallback.trim();
  return method === "STANDARD_ENVELOPE" ? "USPS IMb" : "USPS";
}

function configured(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function configuredKeys(keys: string[]) {
  return keys.filter((key) => configured(process.env[key]));
}

function flattenGroups(groups: string[][]) {
  return Array.from(new Set(groups.flat()));
}

function missingCredentialGroups(groups: string[][]) {
  return groups
    .filter((group) => !group.some((key) => configured(process.env[key])))
    .map((group) => group.join(" or "));
}

export function getShippingProviderAdapterProfile(
  methodInput: string | null | undefined,
): ShippingProviderAdapterProfile {
  const method = safeMethod(methodInput);
  const mode = purchaseMode();
  const standardEnvelopeCredentialGroups = [
    ["TCOS_STANDARD_ENVELOPE_PROVIDER"],
    ["TCOS_STANDARD_ENVELOPE_API_KEY", "IMB_PROVIDER_API_KEY"],
  ];
  const parcelCredentialGroups = [
    ["TCOS_PARCEL_LABEL_PROVIDER", "EASYPOST_API_KEY", "SHIPPO_API_TOKEN"],
  ];
  const coverageCredentialGroups = [
    ["TCOS_SHIPPING_COVERAGE_PROVIDER"],
    ["TCOS_SHIPPING_COVERAGE_API_KEY", "COVERAGE_API_KEY"],
  ];
  const methodCredentialGroups =
    method === "STANDARD_ENVELOPE"
      ? standardEnvelopeCredentialGroups
      : parcelCredentialGroups;
  const credentialKeys = flattenGroups(methodCredentialGroups);
  const coverageCredentialKeys = flattenGroups(coverageCredentialGroups);
  const missingCredentialKeys = missingCredentialGroups(methodCredentialGroups);
  const missingCoverageCredentialKeys =
    missingCredentialGroups(coverageCredentialGroups);
  const liveBlockReason =
    mode === "live"
      ? "Live shipping purchase mode is enabled, but TCOS has no approved live provider adapter wired behind this contract yet."
      : null;

  return {
    method,
    purchaseMode: mode,
    provider: providerForMethod(method),
    providerService: serviceForMethod(method),
    carrier: carrierForMethod(method),
    adapterKey:
      method === "STANDARD_ENVELOPE"
        ? "standard_envelope_imb"
        : "usps_parcel_label",
    adapterStatus: mode === "live" ? "live_blocked" : "dry_run_only",
    livePurchaseSupported: false,
    liveBlockReason,
    credentialKeys,
    configuredCredentialKeys: configuredKeys(credentialKeys),
    missingCredentialKeys,
    credentialStatus: missingCredentialKeys.length === 0
      ? "configured"
      : "missing",
    coverageProvider:
      process.env.TCOS_SHIPPING_COVERAGE_PROVIDER ||
      getShippingCoverage({ method, subtotal: 0 }).provider,
    coverageCredentialKeys,
    configuredCoverageCredentialKeys: configuredKeys(coverageCredentialKeys),
    missingCoverageCredentialKeys,
    coverageCredentialStatus: missingCoverageCredentialKeys.length === 0
      ? "configured"
      : "missing",
    manualPurchaseRequired: true,
  };
}

function postageForRequest(params: {
  method: ShippingMethod;
  shippingAmount: number;
  standardEnvelopeEstimatedOunces?: number | null;
}) {
  if (params.method === "STANDARD_ENVELOPE") {
    return standardEnvelopeRateForEstimatedOunces({
      estimatedOunces: params.standardEnvelopeEstimatedOunces || 1,
    });
  }

  return Number(params.shippingAmount || 0);
}

export async function purchaseShippingLabel(
  request: ShippingProviderPurchaseRequest,
): Promise<ShippingProviderPurchaseResult> {
  const mode = purchaseMode();
  const method = safeMethod(request.method);
  const adapterProfile = getShippingProviderAdapterProfile(method);

  if (mode === "live") {
    throw new Error(
      "Live shipping purchase mode is enabled, but no live provider adapter has been approved in TCOS yet.",
    );
  }

  const provider = providerForMethod(method);
  const providerService = serviceForMethod(method);
  const carrier = carrierForMethod(method, request.carrier);
  const idSuffix = suffix(`${request.orderId}${request.labelId}`);
  const trackingPrefix = method === "STANDARD_ENVELOPE" ? "IMB" : "USPS";
  const trackingNumber = `${trackingPrefix}-TCOS-DRYRUN-${idSuffix}`;
  const postageAmount = Number(
    postageForRequest({
      method,
      shippingAmount: request.shippingAmount,
      standardEnvelopeEstimatedOunces: request.standardEnvelopeEstimatedOunces,
    }).toFixed(2),
  );
  const coverage = getShippingCoverage({
    method,
    subtotal: request.subtotal,
  });

  return {
    mode,
    provider,
    providerService,
    providerLabelId: `dryrun-label-${idSuffix}`,
    providerShipmentId: `dryrun-shipment-${idSuffix}`,
    carrier,
    trackingNumber,
    postageAmount,
    labelUrl: null,
    labelPdfUrl: null,
    labelStatus: "purchased",
    coverageProvider:
      process.env.TCOS_SHIPPING_COVERAGE_PROVIDER || coverage.provider,
    coveragePolicyId: `dryrun-coverage-${idSuffix}`,
    coverageAmount: coverage.coveredAmount,
    coverageStatus: "covered",
    message:
      "TCOS dry-run shipping adapter simulated label and Coverage purchase. No postage was bought.",
    rawProviderPayload: {
      dry_run: true,
      adapter: "tcos_dry_run_shipping_provider",
      adapter_profile: adapterProfile,
      method,
      item_count: request.itemCount,
      standard_envelope_estimated_ounces:
        request.standardEnvelopeEstimatedOunces || null,
      note: "This payload proves the purchase pipeline without contacting a live provider.",
    },
  };
}
