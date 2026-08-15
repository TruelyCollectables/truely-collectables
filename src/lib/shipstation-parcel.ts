import { safeShipStationDownloadUrl } from "./lettertrack-shipstation";

export type ShipStationParcelMethod = "GROUND_ADVANTAGE" | "PRIORITY_MAIL";

export type ShipStationParcelAddress = {
  name: string;
  company?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode?: string | null;
};

export type ShipStationParcelPurchaseRequest = {
  orderId: number;
  method: ShipStationParcelMethod;
  ounces: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  shipTo: ShipStationParcelAddress;
  shipDate?: string;
};

export type ShipStationParcelPurchaseResult = {
  labelId: string;
  shipmentId: string;
  carrierId: string;
  serviceCode: string;
  packageCode: string;
  postageAmount: number;
  labelPdfUrl: string;
  trackingNumber: string;
  trackable: true;
  rawProviderPayload: Record<string, unknown>;
};

export type ShipStationParcelBridgeStatus = {
  enabled: boolean;
  ready: boolean;
  provider: "ShipStation";
  apiKeyConfigured: boolean;
  carrierConfigured: boolean;
  warehouseConfigured: boolean;
  shipFromConfigured: boolean;
  groundAdvantageServiceCode: string;
  priorityMailServiceCode: string;
  packageCode: string;
  missing: string[];
};

const SHIPSTATION_API_BASE = "https://api.shipstation.com";

function configured(value: string | undefined) {
  return Boolean(value && value.trim());
}

function normalizedCountry(value: string | null | undefined) {
  const normalized = String(value || "US").trim().toUpperCase();
  if (normalized === "USA" || normalized === "UNITED STATES") return "US";
  return normalized || "US";
}

function shipFromConfigured() {
  return [
    "TCOS_SHIP_FROM_NAME",
    "TCOS_SHIP_FROM_ADDRESS_LINE1",
    "TCOS_SHIP_FROM_CITY",
    "TCOS_SHIP_FROM_STATE",
    "TCOS_SHIP_FROM_POSTAL_CODE",
  ].every((key) => configured(process.env[key]));
}

export function getShipStationParcelBridgeStatus(): ShipStationParcelBridgeStatus {
  const enabled = process.env.TCOS_SHIPSTATION_PARCEL_LIVE_ENABLED === "true";
  const apiKeyConfigured = configured(process.env.SHIPSTATION_API_KEY);
  const carrierConfigured = configured(process.env.SHIPSTATION_CARRIER_ID);
  const warehouseConfigured = configured(process.env.SHIPSTATION_WAREHOUSE_ID);
  const explicitShipFromConfigured = shipFromConfigured();
  const groundAdvantageServiceCode =
    process.env.SHIPSTATION_GROUND_ADVANTAGE_SERVICE_CODE ||
    "usps_ground_advantage";
  const priorityMailServiceCode =
    process.env.SHIPSTATION_PRIORITY_MAIL_SERVICE_CODE || "usps_priority_mail";
  const packageCode = process.env.SHIPSTATION_PARCEL_PACKAGE_CODE || "package";
  const missing = [
    !apiKeyConfigured ? "SHIPSTATION_API_KEY" : null,
    !carrierConfigured ? "SHIPSTATION_CARRIER_ID" : null,
    !warehouseConfigured && !explicitShipFromConfigured
      ? "SHIPSTATION_WAREHOUSE_ID or TCOS_SHIP_FROM_*"
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    enabled,
    ready: enabled && missing.length === 0,
    provider: "ShipStation",
    apiKeyConfigured,
    carrierConfigured,
    warehouseConfigured,
    shipFromConfigured: explicitShipFromConfigured,
    groundAdvantageServiceCode,
    priorityMailServiceCode,
    packageCode,
    missing,
  };
}

function safeDate(value: string | undefined) {
  const normalized = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return new Date().toISOString().slice(0, 10);
}

function providerAddress(address: ShipStationParcelAddress) {
  return {
    name: address.name.trim(),
    company_name: String(address.company || "").trim() || null,
    address_line1: address.addressLine1.trim(),
    address_line2: String(address.addressLine2 || "").trim() || null,
    city_locality: address.city.trim(),
    state_province: address.state.trim(),
    postal_code: address.postalCode.trim(),
    country_code: normalizedCountry(address.countryCode),
    address_residential_indicator: "yes",
  };
}

function shipFromObject() {
  if (configured(process.env.SHIPSTATION_WAREHOUSE_ID)) {
    return { warehouse_id: process.env.SHIPSTATION_WAREHOUSE_ID!.trim() };
  }

  return {
    ship_from: providerAddress({
      name: process.env.TCOS_SHIP_FROM_NAME || "",
      company: process.env.TCOS_SHIP_FROM_COMPANY || "Truely Collectables",
      addressLine1: process.env.TCOS_SHIP_FROM_ADDRESS_LINE1 || "",
      addressLine2: process.env.TCOS_SHIP_FROM_ADDRESS_LINE2 || "",
      city: process.env.TCOS_SHIP_FROM_CITY || "",
      state: process.env.TCOS_SHIP_FROM_STATE || "",
      postalCode: process.env.TCOS_SHIP_FROM_POSTAL_CODE || "",
      countryCode: process.env.TCOS_SHIP_FROM_COUNTRY || "US",
    }),
  };
}

function finitePositive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be greater than zero.`);
  }
}

export function buildShipStationParcelLabelRequest(
  request: ShipStationParcelPurchaseRequest,
) {
  const status = getShipStationParcelBridgeStatus();
  const ounces = Number(request.ounces);
  const lengthIn = Number(request.lengthIn);
  const widthIn = Number(request.widthIn);
  const heightIn = Number(request.heightIn);

  finitePositive(ounces, "Package weight");
  finitePositive(lengthIn, "Package length");
  finitePositive(widthIn, "Package width");
  finitePositive(heightIn, "Package height");

  if (ounces > 1120) {
    throw new Error("USPS parcel weight cannot exceed 70 pounds.");
  }

  if (lengthIn > 22 || widthIn > 18 || heightIn > 15) {
    throw new Error(
      "TCOS ShipStation USPS parcel bridge is limited to packages no larger than 22 x 18 x 15 inches.",
    );
  }

  if (normalizedCountry(request.shipTo.countryCode) !== "US") {
    throw new Error("TCOS ShipStation parcel purchasing is currently US-only.");
  }

  const requiredAddress = [
    request.shipTo.name,
    request.shipTo.addressLine1,
    request.shipTo.city,
    request.shipTo.state,
    request.shipTo.postalCode,
  ].map((value) => String(value || "").trim());

  if (requiredAddress.some((value) => !value)) {
    throw new Error("The recipient shipping address is incomplete.");
  }

  const serviceCode =
    request.method === "PRIORITY_MAIL"
      ? status.priorityMailServiceCode
      : status.groundAdvantageServiceCode;

  return {
    shipment: {
      carrier_id: process.env.SHIPSTATION_CARRIER_ID?.trim() || "",
      service_code: serviceCode,
      ship_date: safeDate(request.shipDate),
      external_order_id: `TCOS-${request.orderId}`,
      ship_to: providerAddress(request.shipTo),
      ...shipFromObject(),
      confirmation: "none",
      packages: [
        {
          package_code: status.packageCode,
          weight: {
            value: Number(ounces.toFixed(2)),
            unit: "ounce",
          },
          dimensions: {
            length: Number(lengthIn.toFixed(2)),
            width: Number(widthIn.toFixed(2)),
            height: Number(heightIn.toFixed(2)),
            unit: "inch",
          },
          label_messages: {
            reference1: `TCOS #${request.orderId}`,
            reference2:
              request.method === "PRIORITY_MAIL"
                ? "Priority Mail"
                : "Ground Advantage",
          },
        },
      ],
    },
    validate_address: "validate_and_clean",
    label_format: "pdf",
    label_layout: "4x6",
    label_download_type: "url",
    display_scheme: "label",
  };
}

export async function purchaseShipStationParcelPostage(
  request: ShipStationParcelPurchaseRequest,
): Promise<ShipStationParcelPurchaseResult> {
  const status = getShipStationParcelBridgeStatus();

  if (!status.enabled) {
    throw new Error(
      "ShipStation parcel purchasing is disabled. Set TCOS_SHIPSTATION_PARCEL_LIVE_ENABLED=true only after provider setup and test approval.",
    );
  }

  if (!status.ready) {
    throw new Error(`ShipStation parcel bridge is missing: ${status.missing.join(", ")}.`);
  }

  const payload = buildShipStationParcelLabelRequest(request);
  const response = await fetch(`${SHIPSTATION_API_BASE}/v2/labels`, {
    method: "POST",
    headers: {
      "API-Key": process.env.SHIPSTATION_API_KEY!.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `ShipStation parcel purchase refused an unexpected redirect (HTTP ${response.status}).`,
    );
  }

  const providerPayload = (await response.json().catch(() => ({}))) as Record<
    string,
    any
  >;

  if (!response.ok) {
    const providerMessage =
      providerPayload?.errors?.[0]?.message ||
      providerPayload?.message ||
      `HTTP ${response.status}`;
    throw new Error(`ShipStation parcel purchase failed: ${providerMessage}`);
  }

  const labelPdfUrl = safeShipStationDownloadUrl(
    providerPayload?.label_download?.pdf || providerPayload?.label_download?.href,
  );
  const labelId = String(providerPayload?.label_id || "").trim();
  const shipmentId = String(providerPayload?.shipment_id || "").trim();
  const carrierId = String(providerPayload?.carrier_id || "").trim();
  const serviceCode = String(providerPayload?.service_code || "").trim();
  const packageCode = String(providerPayload?.package_code || "").trim();
  const trackingNumber = String(providerPayload?.tracking_number || "").trim();
  const postageAmount = Number(providerPayload?.shipment_cost?.amount);

  if (
    providerPayload?.status !== "completed" ||
    providerPayload?.trackable !== true ||
    !labelId ||
    !shipmentId ||
    !trackingNumber ||
    !labelPdfUrl ||
    !Number.isFinite(postageAmount)
  ) {
    throw new Error(
      "ShipStation returned an incomplete parcel label response; TCOS did not mark the shipment ready.",
    );
  }

  return {
    labelId,
    shipmentId,
    carrierId,
    serviceCode,
    packageCode: packageCode || status.packageCode,
    postageAmount: Number(postageAmount.toFixed(2)),
    labelPdfUrl,
    trackingNumber,
    trackable: true,
    rawProviderPayload: providerPayload,
  };
}
