export type ShipStationCarrierSummary = {
  carrierId: string;
  carrierCode: string;
  friendlyName: string;
  nickname: string | null;
};

export type ShipStationServiceSummary = {
  serviceCode: string;
  name: string;
  domestic: boolean | null;
  international: boolean | null;
};

export type ShipStationWarehouseSummary = {
  warehouseId: string;
  name: string;
  isDefault: boolean;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type ShipStationConnectionTestResult = {
  ok: boolean;
  apiKeyConfigured: boolean;
  configuredCarrierId: string | null;
  configuredCarrierFound: boolean;
  recommendedCarrierId: string | null;
  configuredWarehouseId: string | null;
  configuredWarehouseFound: boolean;
  recommendedWarehouseId: string | null;
  carriers: ShipStationCarrierSummary[];
  services: ShipStationServiceSummary[];
  warehouses: ShipStationWarehouseSummary[];
  requiredServices: {
    letter: { code: string; available: boolean | null };
    groundAdvantage: { code: string; available: boolean | null };
    priorityMail: { code: string; available: boolean | null };
  };
  postagePurchaseAttempted: false;
  message: string;
};

const API_BASE = "https://api.shipstation.com";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function configuredCarrierId() {
  return clean(process.env.SHIPSTATION_CARRIER_ID) || null;
}

function configuredWarehouseId() {
  return clean(process.env.SHIPSTATION_WAREHOUSE_ID) || null;
}

function preferredUspsCarrier(carriers: ShipStationCarrierSummary[]) {
  const matches = carriers.filter((carrier) => {
    const haystack = `${carrier.carrierCode} ${carrier.friendlyName} ${carrier.nickname || ""}`.toLowerCase();
    return ["usps", "stamps", "endicia", "postal"].some((term) =>
      haystack.includes(term),
    );
  });
  return matches.length === 1 ? matches[0]!.carrierId : null;
}

function preferredWarehouse(warehouses: ShipStationWarehouseSummary[]) {
  const defaults = warehouses.filter((warehouse) => warehouse.isDefault);
  if (defaults.length === 1) return defaults[0]!.warehouseId;
  return warehouses.length === 1 ? warehouses[0]!.warehouseId : null;
}

async function shipStationGet(path: string, apiKey: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "API-Key": apiKey,
      Accept: "application/json",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `ShipStation connection test refused an unexpected redirect (HTTP ${response.status}).`,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    const providerMessage =
      payload?.errors?.[0]?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`ShipStation connection test failed: ${providerMessage}`);
  }
  return payload;
}

export async function testShipStationConnection(): Promise<ShipStationConnectionTestResult> {
  const apiKey = clean(process.env.SHIPSTATION_API_KEY);
  const carrierId = configuredCarrierId();
  const warehouseId = configuredWarehouseId();
  const letterCode = clean(process.env.SHIPSTATION_LETTER_SERVICE_CODE) || "usps_first_class_mail";
  const groundCode =
    clean(process.env.SHIPSTATION_GROUND_ADVANTAGE_SERVICE_CODE) ||
    "usps_ground_advantage";
  const priorityCode =
    clean(process.env.SHIPSTATION_PRIORITY_MAIL_SERVICE_CODE) || "usps_priority_mail";

  if (!apiKey) {
    return {
      ok: false,
      apiKeyConfigured: false,
      configuredCarrierId: carrierId,
      configuredCarrierFound: false,
      recommendedCarrierId: null,
      configuredWarehouseId: warehouseId,
      configuredWarehouseFound: false,
      recommendedWarehouseId: null,
      carriers: [],
      services: [],
      warehouses: [],
      requiredServices: {
        letter: { code: letterCode, available: null },
        groundAdvantage: { code: groundCode, available: null },
        priorityMail: { code: priorityCode, available: null },
      },
      postagePurchaseAttempted: false,
      message:
        "SHIPSTATION_API_KEY is not configured. No provider request and no postage purchase were attempted.",
    };
  }

  const [carrierPayload, warehousePayload] = await Promise.all([
    shipStationGet(
      "/v2/carriers?page=1&page_size=50&include_extended_details=true",
      apiKey,
    ),
    shipStationGet("/v2/warehouses", apiKey),
  ]);

  const carriers: ShipStationCarrierSummary[] = Array.isArray(carrierPayload?.carriers)
    ? carrierPayload.carriers
        .map((row: Record<string, unknown>) => ({
          carrierId: clean(row.carrier_id),
          carrierCode: clean(row.carrier_code),
          friendlyName: clean(row.friendly_name) || clean(row.carrier_code) || "Carrier",
          nickname: clean(row.nickname) || null,
        }))
        .filter((row: ShipStationCarrierSummary) => row.carrierId)
    : [];

  const warehouses: ShipStationWarehouseSummary[] = Array.isArray(warehousePayload?.warehouses)
    ? warehousePayload.warehouses
        .map((row: Record<string, any>) => ({
          warehouseId: clean(row.warehouse_id),
          name: clean(row.name) || "Warehouse",
          isDefault: row.is_default === true,
          city: clean(row.origin_address?.city_locality) || null,
          state: clean(row.origin_address?.state_province) || null,
          postalCode: clean(row.origin_address?.postal_code) || null,
        }))
        .filter((row: ShipStationWarehouseSummary) => row.warehouseId)
    : [];

  const configuredCarrierFound = Boolean(
    carrierId && carriers.some((carrier) => carrier.carrierId === carrierId),
  );
  const recommendedCarrierId = carrierId || preferredUspsCarrier(carriers);
  const configuredWarehouseFound = Boolean(
    warehouseId && warehouses.some((warehouse) => warehouse.warehouseId === warehouseId),
  );
  const recommendedWarehouseId = warehouseId || preferredWarehouse(warehouses);
  let services: ShipStationServiceSummary[] = [];

  if (recommendedCarrierId) {
    const servicePayload = await shipStationGet(
      `/v2/carriers/${encodeURIComponent(recommendedCarrierId)}/services`,
      apiKey,
    );
    services = Array.isArray(servicePayload?.services)
      ? servicePayload.services
          .map((row: Record<string, unknown>) => ({
            serviceCode: clean(row.service_code),
            name: clean(row.name) || clean(row.service_code) || "Service",
            domestic:
              typeof row.domestic === "boolean" ? row.domestic : null,
            international:
              typeof row.international === "boolean" ? row.international : null,
          }))
          .filter((row: ShipStationServiceSummary) => row.serviceCode)
      : [];
  }

  const serviceCodes = new Set(services.map((service) => service.serviceCode));
  const availability = (code: string) =>
    recommendedCarrierId ? serviceCodes.has(code) : null;
  const requiredServices = {
    letter: { code: letterCode, available: availability(letterCode) },
    groundAdvantage: { code: groundCode, available: availability(groundCode) },
    priorityMail: { code: priorityCode, available: availability(priorityCode) },
  };
  const allAvailable = Object.values(requiredServices).every(
    (service) => service.available === true,
  );
  const shippingSetupReady =
    carriers.length > 0 &&
    Boolean(recommendedCarrierId) &&
    allAvailable &&
    Boolean(recommendedWarehouseId);

  return {
    ok: shippingSetupReady,
    apiKeyConfigured: true,
    configuredCarrierId: carrierId,
    configuredCarrierFound,
    recommendedCarrierId,
    configuredWarehouseId: warehouseId,
    configuredWarehouseFound,
    recommendedWarehouseId,
    carriers,
    services,
    warehouses,
    requiredServices,
    postagePurchaseAttempted: false,
    message:
      carriers.length === 0
        ? "The API key authenticated, but ShipStation returned no connected carriers."
        : !recommendedCarrierId
          ? "The API key authenticated. Select/configure a USPS carrier ID from the connected carriers shown below."
          : !allAvailable
            ? "ShipStation authenticated, but one or more TCOS USPS service codes are not exposed by the selected carrier. Review the service list before enabling live purchase."
            : warehouses.length === 0
              ? "Carrier and services are ready, but ShipStation returned no warehouse/ship-from location. Create a ShipStation warehouse before enabling live purchase."
              : !recommendedWarehouseId
                ? "Carrier and services are ready. Select/configure a ShipStation warehouse ID from the ship-from locations shown below."
                : "ShipStation connection is authenticated, the selected USPS carrier exposes all TCOS service codes, and a ship-from warehouse is available. No postage was purchased.",
  };
}
