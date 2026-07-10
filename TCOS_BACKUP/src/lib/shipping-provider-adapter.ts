import {
  getShippingCoverage,
  isShippingMethod,
  standardEnvelopeRateForEstimatedOunces,
  type ShippingMethod,
} from "./shipping";

export type ShippingProviderPurchaseMode = "dry_run" | "live";

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
      method,
      item_count: request.itemCount,
      standard_envelope_estimated_ounces:
        request.standardEnvelopeEstimatedOunces || null,
      note: "This payload proves the purchase pipeline without contacting a live provider.",
    },
  };
}
