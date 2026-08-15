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

export type ShipStationConnectionTestResult = {
  ok: boolean;
  apiKeyConfigured: boolean;
  configuredCarrierId: string | null;
  configuredCarrierFound: boolean;
  recommendedCarrierId: string | null;
  carriers: ShipStationCarrierSummary[];
  services: ShipStationServiceSummary[];
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

function preferredUspsCarrier(carriers: ShipStationCarrierSummary[]) {
  const matches = carriers.filter((carrier) => {
    const haystack = `${carrier.carrierCode} ${carrier.friendlyName} ${carrier.nickname || ""}`.toLowerCase();
    return ["usps", "stamps", "endicia", "postal"].some((term) =>
      haystack.includes(term),
    );
  });
  return matches.length === 1 ? matches[0]!.carrierId : null;
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
      carriers: [],
      services: [],
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

  const carrierPayload = await shipStationGet(
    "/v2/carriers?page=1&page_size=50&include_extended_details=true",
    apiKey,
  );
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

  const configuredCarrierFound = Boolean(
    carrierId && carriers.some((carrier) => carrier.carrierId === carrierId),
  );
  const recommendedCarrierId = carrierId || preferredUspsCarrier(carriers);
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

  return {
    ok: carriers.length > 0 && Boolean(recommendedCarrierId) && allAvailable,
    apiKeyConfigured: true,
    configuredCarrierId: carrierId,
    configuredCarrierFound,
    recommendedCarrierId,
    carriers,
    services,
    requiredServices,
    postagePurchaseAttempted: false,
    message:
      carriers.length === 0
        ? "The API key authenticated, but ShipStation returned no connected carriers."
        : !recommendedCarrierId
          ? "The API key authenticated. Select/configure a USPS carrier ID from the connected carriers shown below."
          : allAvailable
            ? "ShipStation connection is authenticated and the selected USPS carrier exposes all TCOS shipping service codes. No postage was purchased."
            : "ShipStation authenticated, but one or more TCOS USPS service codes are not exposed by the selected carrier. Review the service list before enabling live purchase.",
  };
}
