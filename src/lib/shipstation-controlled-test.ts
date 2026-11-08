import { safeShipStationDownloadUrl } from "./lettertrack-shipstation";
import { getShipStationOrigin } from "./shipstation-origin";

const API_BASE = "https://api.shipengine.com";
const SERVICE_CODE = "usps_first_class_mail";
const PACKAGE_CODE = "letter";
const WEIGHT_OZ = 1;
const DEFAULT_MAX_POSTAGE = 2;

export type ControlledTestAddress = {
  name: string;
  company?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode?: string | null;
};

export type ControlledTestQuote = {
  rateId: string | null;
  carrierId: string;
  serviceCode: string;
  packageCode: string;
  ounces: 1;
  postageAmount: number;
  deliveryDays: number | null;
  estimatedDeliveryDate: string | null;
  warningMessages: string[];
  purchaseEnabled: boolean;
  maxPostage: number;
};

export type ControlledTestPurchase = {
  reused: boolean;
  externalShipmentId: string;
  labelId: string;
  shipmentId: string;
  carrierId: string;
  serviceCode: string;
  packageCode: string;
  ounces: 1;
  postageAmount: number;
  trackingNumber: string | null;
  trackable: boolean;
  labelPdfUrl: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedCountry(value: unknown) {
  const country = clean(value || "US").toUpperCase();
  if (country === "USA" || country === "UNITED STATES") return "US";
  return country || "US";
}

function normalizeAddress(value: ControlledTestAddress): ControlledTestAddress {
  return {
    name: clean(value.name),
    company: clean(value.company) || null,
    addressLine1: clean(value.addressLine1),
    addressLine2: clean(value.addressLine2) || null,
    city: clean(value.city),
    state: clean(value.state).toUpperCase(),
    postalCode: clean(value.postalCode),
    countryCode: normalizedCountry(value.countryCode),
  };
}

function validateAddress(value: ControlledTestAddress) {
  const address = normalizeAddress(value);
  const missing = Object.entries({
    name: address.name,
    addressLine1: address.addressLine1,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  })
    .filter(([, field]) => !clean(field))
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Test destination is incomplete: ${missing.join(", ")}.`);
  }
  if (normalizedCountry(address.countryCode) !== "US") {
    throw new Error("Controlled ShipStation test shipment is US-only.");
  }
  return address;
}

function providerAddress(value: ControlledTestAddress, residential: "yes" | "no") {
  const address = validateAddress(value);
  return {
    name: address.name,
    company_name: address.company || null,
    address_line1: address.addressLine1,
    address_line2: address.addressLine2 || null,
    city_locality: address.city,
    state_province: address.state,
    postal_code: address.postalCode,
    country_code: normalizedCountry(address.countryCode),
    address_residential_indicator: residential,
  };
}

function apiKey() {
  const value = clean(process.env.SHIPSTATION_API_KEY);
  if (!value) throw new Error("SHIPSTATION_API_KEY is not configured.");
  return value;
}

function carrierId() {
  const value = clean(process.env.SHIPSTATION_CARRIER_ID);
  if (!value) throw new Error("SHIPSTATION_CARRIER_ID is not configured.");
  return value;
}

function purchaseEnabled() {
  return process.env.TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED === "true";
}

function maxPostage() {
  const configured = Number(process.env.TCOS_SHIPSTATION_TEST_MAX_POSTAGE || DEFAULT_MAX_POSTAGE);
  return Number.isFinite(configured) && configured > 0
    ? Number(configured.toFixed(2))
    : DEFAULT_MAX_POSTAGE;
}

function shipDate() {
  return new Date().toISOString().slice(0, 10);
}

function amount(value: any) {
  const parsed = Number(value?.amount ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function providerError(payload: Record<string, any>, status: number) {
  return (
    payload?.errors?.[0]?.message ||
    payload?.message ||
    payload?.error ||
    `HTTP ${status}`
  );
}

async function providerRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "API-Key": apiKey(),
      Accept: "application/json",
      ...(init.headers || {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`ShipStation API refused an unexpected redirect (HTTP ${response.status}).`);
  }
  return response;
}

async function shipmentPayload(destination: ControlledTestAddress, includeExternalId?: string) {
  const origin = await getShipStationOrigin();
  if (!origin) {
    throw new Error("Save the TruelyCollectables ship-from address before running a controlled shipment test.");
  }

  const shipment: Record<string, unknown> = {
    validate_address: "validate_and_clean",
    carrier_id: carrierId(),
    service_code: SERVICE_CODE,
    ship_date: shipDate(),
    external_order_id: "TCOS-CONTROLLED-1OZ-TEST",
    ship_to: providerAddress(destination, "yes"),
    ship_from: providerAddress(origin, "no"),
    packages: [
      {
        package_code: PACKAGE_CODE,
        weight: { value: WEIGHT_OZ, unit: "ounce" },
        label_messages: {
          reference1: "TCOS CONTROLLED TEST",
          reference2: "1 OZ LETTER",
        },
      },
    ],
  };

  if (includeExternalId) shipment.external_shipment_id = includeExternalId;
  return { shipment, origin };
}

async function deterministicExternalShipmentId(
  destination: ControlledTestAddress,
  origin: ControlledTestAddress,
) {
  const destinationNormalized = validateAddress(destination);
  const originNormalized = validateAddress(origin);
  const raw = JSON.stringify({
    version: 1,
    date: shipDate(),
    carrierId: carrierId(),
    serviceCode: SERVICE_CODE,
    packageCode: PACKAGE_CODE,
    ounces: WEIGHT_OZ,
    destination: destinationNormalized,
    origin: originNormalized,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `tcos-test-${shipDate().replaceAll("-", "")}-${hex.slice(0, 20)}`;
}

function parseLabel(payload: Record<string, any>, externalShipmentId: string, reused: boolean) {
  const labelPdfUrl = safeShipStationDownloadUrl(
    payload?.label_download?.pdf || payload?.label_download?.href,
  );
  const labelId = clean(payload?.label_id);
  const shipmentId = clean(payload?.shipment_id);
  const carrier = clean(payload?.carrier_id);
  const serviceCode = clean(payload?.service_code) || SERVICE_CODE;
  const packageCode = clean(payload?.package_code) || PACKAGE_CODE;
  const postageAmount = Number(payload?.shipment_cost?.amount);

  if (
    payload?.status !== "completed" ||
    !labelId ||
    !shipmentId ||
    !labelPdfUrl ||
    !Number.isFinite(postageAmount)
  ) {
    throw new Error("ShipStation API returned an incomplete controlled-test label response.");
  }

  return {
    reused,
    externalShipmentId,
    labelId,
    shipmentId,
    carrierId: carrier || carrierId(),
    serviceCode,
    packageCode,
    ounces: 1 as const,
    postageAmount: Number(postageAmount.toFixed(2)),
    trackingNumber: clean(payload?.tracking_number) || null,
    trackable: payload?.trackable === true,
    labelPdfUrl,
  } satisfies ControlledTestPurchase;
}

async function findExistingLabel(externalShipmentId: string) {
  const response = await providerRequest(
    `/v1/labels/external_shipment_id/${encodeURIComponent(externalShipmentId)}?label_download_type=url`,
  );
  if (response.status === 404) return null;
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(`ShipStation label lookup failed: ${providerError(payload, response.status)}`);
  }
  return parseLabel(payload, externalShipmentId, true);
}

export function controlledTestStatus() {
  return {
    purchaseEnabled: purchaseEnabled(),
    maxPostage: maxPostage(),
    serviceCode: SERVICE_CODE,
    packageCode: PACKAGE_CODE,
    ounces: WEIGHT_OZ,
  };
}

export async function quoteControlledOneOunceLetter(
  destinationInput: ControlledTestAddress,
): Promise<ControlledTestQuote> {
  const destination = validateAddress(destinationInput);
  const { shipment } = await shipmentPayload(destination);
  const response = await providerRequest("/v1/rates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rate_options: {
        carrier_ids: [carrierId()],
        service_codes: [SERVICE_CODE],
        package_types: [PACKAGE_CODE],
      },
      shipment,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(`ShipStation test quote failed: ${providerError(payload, response.status)}`);
  }

  const rates = Array.isArray(payload?.rates)
    ? payload.rates
    : Array.isArray(payload?.rate_response?.rates)
      ? payload.rate_response.rates
      : [];
  const matching = rates
    .filter((rate: any) => clean(rate?.service_code) === SERVICE_CODE)
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

  if (!matching.length) {
    const invalid = Array.isArray(payload?.invalid_rates)
      ? payload.invalid_rates
          .flatMap((rate: any) => rate?.error_messages || rate?.warning_messages || [])
          .filter(Boolean)
      : [];
    throw new Error(
      `ShipStation returned no usable 1 oz First-Class Letter rate.${invalid.length ? ` ${invalid.join("; ")}` : ""}`,
    );
  }

  const selected = matching[0]!.rate;
  return {
    rateId: clean(selected?.rate_id) || null,
    carrierId: clean(selected?.carrier_id) || carrierId(),
    serviceCode: clean(selected?.service_code) || SERVICE_CODE,
    packageCode: clean(selected?.package_type || selected?.package_code) || PACKAGE_CODE,
    ounces: 1,
    postageAmount: Number(matching[0]!.total.toFixed(2)),
    deliveryDays: Number.isFinite(Number(selected?.delivery_days))
      ? Number(selected.delivery_days)
      : null,
    estimatedDeliveryDate: clean(selected?.estimated_delivery_date) || null,
    warningMessages: Array.isArray(selected?.warning_messages)
      ? selected.warning_messages.map((value: unknown) => clean(value)).filter(Boolean)
      : [],
    purchaseEnabled: purchaseEnabled(),
    maxPostage: maxPostage(),
  };
}

export async function purchaseControlledOneOunceLetter(
  destinationInput: ControlledTestAddress,
): Promise<ControlledTestPurchase> {
  if (!purchaseEnabled()) {
    throw new Error(
      "Controlled real-postage test is locked. Set TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED=true only after the no-purchase quote is approved.",
    );
  }

  const destination = validateAddress(destinationInput);
  const quote = await quoteControlledOneOunceLetter(destination);
  const limit = maxPostage();
  if (quote.postageAmount > limit) {
    throw new Error(
      `Controlled test purchase blocked: quoted postage $${quote.postageAmount.toFixed(2)} exceeds the $${limit.toFixed(2)} safety cap.`,
    );
  }

  const { shipment, origin } = await shipmentPayload(destination);
  const externalShipmentId = await deterministicExternalShipmentId(destination, origin);
  const existing = await findExistingLabel(externalShipmentId);
  if (existing) return existing;

  let response: Response;
  try {
    response = await providerRequest("/v1/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipment: {
          ...shipment,
          external_shipment_id: externalShipmentId,
        },
        label_format: "pdf",
        label_layout: "4x6",
        label_download_type: "url",
        display_scheme: "label",
      }),
    });
  } catch (error: any) {
    const reconciled = await findExistingLabel(externalShipmentId).catch(() => null);
    if (reconciled) return reconciled;
    throw new Error(
      `ShipStation controlled test purchase outcome is uncertain after a provider/network failure. Retry the identical test shipment without changing the destination; TCOS will reconcile the same external shipment ID before submitting another purchase. ${clean(error?.message)}`.trim(),
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    const reconciled = await findExistingLabel(externalShipmentId).catch(() => null);
    if (reconciled) return reconciled;
    throw new Error(`ShipStation controlled test purchase failed: ${providerError(payload, response.status)}`);
  }

  return parseLabel(payload, externalShipmentId, false);
}

export async function getControlledTestLabel(externalShipmentId: string) {
  const normalized = clean(externalShipmentId);
  if (!/^tcos-test-\d{8}-[a-f0-9]{20}$/.test(normalized)) {
    throw new Error("Invalid controlled test shipment id.");
  }
  const existing = await findExistingLabel(normalized);
  if (!existing) throw new Error("Controlled test label was not found in ShipStation.");
  return existing;
}
