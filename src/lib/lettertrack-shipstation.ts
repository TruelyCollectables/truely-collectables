import {
  getShipStationOrigin,
  normalizeShipStationOrigin,
  type ShipStationOriginAddress,
} from "./shipstation-origin";

export type LetterTrackShipStationAddress = {
  name: string;
  company?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode?: string | null;
};

export type LetterTrackShipStationPurchaseRequest = {
  orderId: number;
  ounces: number;
  shipTo: LetterTrackShipStationAddress;
  shipDate?: string;
};

export type LetterTrackShipStationPurchaseResult = {
  labelId: string;
  shipmentId: string;
  carrierId: string;
  serviceCode: string;
  packageCode: string;
  postageAmount: number;
  labelPdfUrl: string;
  trackingNumber: string | null;
  trackable: boolean;
  rawProviderPayload: Record<string, unknown>;
};

export type LetterTrackShipStationQuoteResult = {
  rateId: string | null;
  shipmentId: string | null;
  carrierId: string;
  serviceCode: string;
  packageCode: string;
  postageAmount: number;
  deliveryDays: number | null;
  estimatedDeliveryDate: string | null;
  warningMessages: string[];
};

export type LetterTrackShipStationBridgeStatus = {
  enabled: boolean;
  ready: boolean;
  requiresExplicitPurchaseConfirmation: true;
  provider: "ShipStation API";
  apiProduct: "ShipStation API (formerly ShipEngine)";
  letterTrackFinalizeRequired: true;
  apiKeyConfigured: boolean;
  carrierConfigured: boolean;
  warehouseConfigured: false;
  shipFromConfigured: boolean;
  serviceCode: string;
  packageCode: string;
  missing: string[];
};

const SHIPSTATION_API_BASE = "https://api.shipengine.com";
const SHIPSTATION_DOWNLOAD_HOSTS = new Set([
  "api.shipstation.com",
  "api.shipengine.com",
]);

function configured(value: string | undefined) {
  return Boolean(value && value.trim());
}

function normalizedCountry(value: string | null | undefined) {
  const normalized = String(value || "US").trim().toUpperCase();
  if (normalized === "USA" || normalized === "UNITED STATES") return "US";
  return normalized || "US";
}

function envShipFrom() {
  return normalizeShipStationOrigin({
    name: process.env.TCOS_SHIP_FROM_NAME,
    company: process.env.TCOS_SHIP_FROM_COMPANY || "Truely Collectables",
    addressLine1: process.env.TCOS_SHIP_FROM_ADDRESS_LINE1,
    addressLine2: process.env.TCOS_SHIP_FROM_ADDRESS_LINE2,
    city: process.env.TCOS_SHIP_FROM_CITY,
    state: process.env.TCOS_SHIP_FROM_STATE,
    postalCode: process.env.TCOS_SHIP_FROM_POSTAL_CODE,
    countryCode: process.env.TCOS_SHIP_FROM_COUNTRY || "US",
  });
}

export function getLetterTrackShipStationBridgeStatus(): LetterTrackShipStationBridgeStatus {
  const enabled =
    process.env.TCOS_LETTERTRACK_SHIPSTATION_LIVE_ENABLED === "true";
  const apiKeyConfigured = configured(process.env.SHIPSTATION_API_KEY);
  const carrierConfigured = configured(process.env.SHIPSTATION_CARRIER_ID);
  const serviceCode =
    process.env.SHIPSTATION_LETTER_SERVICE_CODE || "usps_first_class_mail";
  const packageCode = process.env.SHIPSTATION_LETTER_PACKAGE_CODE || "letter";
  const missing = [
    !apiKeyConfigured ? "SHIPSTATION_API_KEY" : null,
    !carrierConfigured ? "SHIPSTATION_CARRIER_ID" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    enabled,
    ready: enabled && missing.length === 0,
    requiresExplicitPurchaseConfirmation: true,
    provider: "ShipStation API",
    apiProduct: "ShipStation API (formerly ShipEngine)",
    letterTrackFinalizeRequired: true,
    apiKeyConfigured,
    carrierConfigured,
    warehouseConfigured: false,
    shipFromConfigured: Boolean(envShipFrom()),
    serviceCode,
    packageCode,
    missing,
  };
}

function safeDate(value: string | undefined) {
  const normalized = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return new Date().toISOString().slice(0, 10);
}

function providerAddress(
  address: LetterTrackShipStationAddress | ShipStationOriginAddress,
  residential: "yes" | "no",
) {
  return {
    name: address.name.trim(),
    company_name: String(address.company || "").trim() || null,
    address_line1: address.addressLine1.trim(),
    address_line2: String(address.addressLine2 || "").trim() || null,
    city_locality: address.city.trim(),
    state_province: address.state.trim(),
    postal_code: address.postalCode.trim(),
    country_code: normalizedCountry(address.countryCode),
    address_residential_indicator: residential,
  };
}

export function buildLetterTrackShipStationLabelRequest(
  request: LetterTrackShipStationPurchaseRequest,
  shipFromOverride?: ShipStationOriginAddress | null,
) {
  const status = getLetterTrackShipStationBridgeStatus();
  const ounces = Number(request.ounces);
  const shipFrom = shipFromOverride || envShipFrom();

  if (!Number.isFinite(ounces) || ounces <= 0 || ounces > 3.5) {
    throw new Error(
      "Standard Envelope letter postage requires a weight greater than 0 and no more than 3.5 ounces.",
    );
  }
  if (!shipFrom) {
    throw new Error("The TruelyCollectables ShipStation ship-from address is not configured.");
  }
  if (normalizedCountry(request.shipTo.countryCode) !== "US") {
    throw new Error("LetterTrack Standard Envelope bridge is US-only.");
  }
  if (normalizedCountry(shipFrom.countryCode) !== "US") {
    throw new Error("TCOS ShipStation ship-from address must be in the US.");
  }

  const requiredTo = [
    request.shipTo.name,
    request.shipTo.addressLine1,
    request.shipTo.city,
    request.shipTo.state,
    request.shipTo.postalCode,
  ].map((value) => String(value || "").trim());
  if (requiredTo.some((value) => !value)) {
    throw new Error("The recipient shipping address is incomplete.");
  }

  return {
    shipment: {
      validate_address: "validate_and_clean",
      carrier_id: process.env.SHIPSTATION_CARRIER_ID?.trim() || "",
      service_code: status.serviceCode,
      ship_date: safeDate(request.shipDate),
      external_order_id: `TCOS-${request.orderId}`,
      ship_to: providerAddress(request.shipTo, "yes"),
      ship_from: providerAddress(shipFrom, "no"),
      packages: [
        {
          package_code: status.packageCode,
          weight: {
            value: Number(ounces.toFixed(2)),
            unit: "ounce",
          },
          label_messages: {
            reference1: `TCOS #${request.orderId}`,
            reference2: "LetterTrack",
          },
        },
      ],
    },
    label_format: "pdf",
    label_layout: "4x6",
    label_download_type: "url",
    display_scheme: "label",
  };
}

function providerErrorMessage(payload: Record<string, any>, status: number) {
  return (
    payload?.errors?.[0]?.message ||
    payload?.message ||
    payload?.error ||
    `HTTP ${status}`
  );
}

function amount(value: any) {
  const parsed = Number(value?.amount ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function quoteLetterTrackShipStationPostage(
  request: LetterTrackShipStationPurchaseRequest,
): Promise<LetterTrackShipStationQuoteResult> {
  const status = getLetterTrackShipStationBridgeStatus();
  if (!status.apiKeyConfigured || !status.carrierConfigured) {
    throw new Error(
      `ShipStation API quote is missing: ${status.missing.join(", ")}.`,
    );
  }
  const shipFrom = await getShipStationOrigin();
  if (!shipFrom) {
    throw new Error(
      "TruelyCollectables does not have a saved ShipStation ship-from address. Save it in Admin → Shipping → ShipStation Test first.",
    );
  }

  const labelPayload = buildLetterTrackShipStationLabelRequest(request, shipFrom);
  const response = await fetch(`${SHIPSTATION_API_BASE}/v1/rates`, {
    method: "POST",
    headers: {
      "API-Key": process.env.SHIPSTATION_API_KEY!.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      rate_options: {
        carrier_ids: [process.env.SHIPSTATION_CARRIER_ID!.trim()],
        service_codes: [status.serviceCode],
        package_types: [status.packageCode],
      },
      shipment: labelPayload.shipment,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `ShipStation API rate quote refused an unexpected redirect (HTTP ${response.status}).`,
    );
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(
      `ShipStation API rate quote failed: ${providerErrorMessage(payload, response.status)}`,
    );
  }

  const rates = Array.isArray(payload?.rates)
    ? payload.rates
    : Array.isArray(payload?.rate_response?.rates)
      ? payload.rate_response.rates
      : [];
  const matching = rates.filter((rate: any) => {
    const service = String(rate?.service_code || "").trim();
    const packageCode = String(rate?.package_type || rate?.package_code || "").trim();
    return (
      service === status.serviceCode &&
      (!packageCode || packageCode === status.packageCode)
    );
  });
  const priced = matching
    .map((rate: any) => ({
      rate,
      total:
        amount(rate?.shipping_amount) +
        amount(rate?.insurance_amount) +
        amount(rate?.confirmation_amount) +
        amount(rate?.other_amount) +
        amount(rate?.tax_amount),
    }))
    .filter((entry: any) => Number.isFinite(entry.total) && entry.total >= 0)
    .sort((a: any, b: any) => a.total - b.total);

  if (!priced.length) {
    const invalid = Array.isArray(payload?.invalid_rates)
      ? payload.invalid_rates
          .flatMap((rate: any) => rate?.error_messages || rate?.warning_messages || [])
          .filter(Boolean)
      : [];
    throw new Error(
      `ShipStation API returned no usable ${status.serviceCode}/${status.packageCode} rate.${invalid.length ? ` ${invalid.join("; ")}` : ""}`,
    );
  }

  const selected = priced[0]!.rate;
  const total = Number(priced[0]!.total.toFixed(2));
  return {
    rateId: String(selected?.rate_id || "").trim() || null,
    shipmentId:
      String(payload?.shipment_id || payload?.rate_response?.shipment_id || "").trim() ||
      null,
    carrierId:
      String(selected?.carrier_id || process.env.SHIPSTATION_CARRIER_ID || "").trim(),
    serviceCode: String(selected?.service_code || status.serviceCode).trim(),
    packageCode: String(
      selected?.package_type || selected?.package_code || status.packageCode,
    ).trim(),
    postageAmount: total,
    deliveryDays: Number.isFinite(Number(selected?.delivery_days))
      ? Number(selected.delivery_days)
      : null,
    estimatedDeliveryDate:
      String(selected?.estimated_delivery_date || "").trim() || null,
    warningMessages: Array.isArray(selected?.warning_messages)
      ? selected.warning_messages.map((value: unknown) => String(value)).filter(Boolean)
      : [],
  };
}

export function safeShipStationDownloadUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !SHIPSTATION_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null;
  }
  url.protocol = "https:";
  return url.toString();
}

export async function purchaseLetterTrackShipStationPostage(
  request: LetterTrackShipStationPurchaseRequest,
): Promise<LetterTrackShipStationPurchaseResult> {
  const status = getLetterTrackShipStationBridgeStatus();
  if (!status.enabled) {
    throw new Error(
      "LetterTrack/ShipStation API live postage bridge is disabled. Set TCOS_LETTERTRACK_SHIPSTATION_LIVE_ENABLED=true only after provider setup and test approval.",
    );
  }
  if (!status.ready) {
    throw new Error(
      `LetterTrack/ShipStation API bridge is missing: ${status.missing.join(", ")}.`,
    );
  }

  const shipFrom = await getShipStationOrigin();
  if (!shipFrom) {
    throw new Error(
      "TruelyCollectables does not have a saved ShipStation ship-from address. Save it in Admin → Shipping → ShipStation Test before purchasing postage.",
    );
  }

  const response = await fetch(`${SHIPSTATION_API_BASE}/v1/labels`, {
    method: "POST",
    headers: {
      "API-Key": process.env.SHIPSTATION_API_KEY!.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildLetterTrackShipStationLabelRequest(request, shipFrom)),
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `ShipStation API postage purchase refused an unexpected redirect (HTTP ${response.status}).`,
    );
  }
  const providerPayload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(
      `ShipStation API postage purchase failed: ${providerErrorMessage(providerPayload, response.status)}`,
    );
  }

  const labelPdfUrl = safeShipStationDownloadUrl(
    providerPayload?.label_download?.pdf || providerPayload?.label_download?.href,
  );
  const labelId = String(providerPayload?.label_id || "").trim();
  const shipmentId = String(providerPayload?.shipment_id || "").trim();
  const carrierId = String(providerPayload?.carrier_id || "").trim();
  const serviceCode = String(providerPayload?.service_code || "").trim();
  const packageCode = String(providerPayload?.package_code || "").trim();
  const postageAmount = Number(providerPayload?.shipment_cost?.amount);

  if (
    providerPayload?.status !== "completed" ||
    !labelId ||
    !shipmentId ||
    !labelPdfUrl ||
    !Number.isFinite(postageAmount)
  ) {
    throw new Error(
      "ShipStation API returned an incomplete label response; TCOS did not mark the LetterTrack shipment ready.",
    );
  }

  return {
    labelId,
    shipmentId,
    carrierId,
    serviceCode: serviceCode || status.serviceCode,
    packageCode: packageCode || status.packageCode,
    postageAmount: Number(postageAmount.toFixed(2)),
    labelPdfUrl,
    trackingNumber: String(providerPayload?.tracking_number || "").trim() || null,
    trackable: providerPayload?.trackable === true,
    rawProviderPayload: providerPayload,
  };
}
