import type { ShipStationOriginAddress } from "./shipstation-origin";

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
  shipFrom: ShipStationOriginAddress;
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

function envShipFromConfigured() {
  return [
    "TCOS_SHIP_FROM_NAME",
    "TCOS_SHIP_FROM_ADDRESS_LINE1",
    "TCOS_SHIP_FROM_CITY",
    "TCOS_SHIP_FROM_STATE",
    "TCOS_SHIP_FROM_POSTAL_CODE",
  ].every((key) => configured(process.env[key]));
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
    shipFromConfigured: envShipFromConfigured(),
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
) {
  const status = getLetterTrackShipStationBridgeStatus();
  const ounces = Number(request.ounces);

  if (!Number.isFinite(ounces) || ounces <= 0 || ounces > 3.5) {
    throw new Error(
      "Standard Envelope letter postage requires a weight greater than 0 and no more than 3.5 ounces.",
    );
  }
  if (normalizedCountry(request.shipTo.countryCode) !== "US") {
    throw new Error("LetterTrack Standard Envelope bridge is US-only.");
  }
  if (normalizedCountry(request.shipFrom.countryCode) !== "US") {
    throw new Error("TCOS ShipStation ship-from address must be in the US.");
  }

  const requiredTo = [
    request.shipTo.name,
    request.shipTo.addressLine1,
    request.shipTo.city,
    request.shipTo.state,
    request.shipTo.postalCode,
  ].map((value) => String(value || "").trim());
  const requiredFrom = [
    request.shipFrom.name,
    request.shipFrom.addressLine1,
    request.shipFrom.city,
    request.shipFrom.state,
    request.shipFrom.postalCode,
  ].map((value) => String(value || "").trim());

  if (requiredTo.some((value) => !value)) {
    throw new Error("The recipient shipping address is incomplete.");
  }
  if (requiredFrom.some((value) => !value)) {
    throw new Error("The TruelyCollectables ship-from address is incomplete.");
  }

  return {
    shipment: {
      validate_address: "validate_and_clean",
      carrier_id: process.env.SHIPSTATION_CARRIER_ID?.trim() || "",
      service_code: status.serviceCode,
      ship_date: safeDate(request.shipDate),
      external_order_id: `TCOS-${request.orderId}`,
      ship_to: providerAddress(request.shipTo, "yes"),
      ship_from: providerAddress(request.shipFrom, "no"),
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

  const response = await fetch(`${SHIPSTATION_API_BASE}/v1/labels`, {
    method: "POST",
    headers: {
      "API-Key": process.env.SHIPSTATION_API_KEY!.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildLetterTrackShipStationLabelRequest(request)),
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
    const providerMessage =
      providerPayload?.errors?.[0]?.message ||
      providerPayload?.message ||
      `HTTP ${response.status}`;
    throw new Error(`ShipStation API postage purchase failed: ${providerMessage}`);
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
