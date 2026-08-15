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

export type ShipStationPackageSummary = {
  packageCode: string;
  name: string;
};

export type ShipStationConnectionTestResult = {
  ok: boolean;
  apiKeyConfigured: boolean;
  apiProduct: "ShipStation API (formerly ShipEngine)";
  configuredCarrierId: string | null;
  configuredCarrierFound: boolean;
  recommendedCarrierId: string | null;
  carriers: ShipStationCarrierSummary[];
  services: ShipStationServiceSummary[];
  packages: ShipStationPackageSummary[];
  requiredServices: {
    letter: { code: string; available: boolean | null };
    groundAdvantage: { code: string; available: boolean | null };
    priorityMail: { code: string; available: boolean | null };
  };
  requiredPackages: {
    letter: { code: string; available: boolean | null };
    parcel: { code: string; available: boolean | null };
  };
  postagePurchaseAttempted: false;
  message: string;
};

const API_BASE = "https://api.shipengine.com";

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
      `ShipStation API connection test refused an unexpected redirect (HTTP ${response.status}).`,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    const providerMessage =
      payload?.errors?.[0]?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`ShipStation API connection test failed: ${providerMessage}`);
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
  const letterPackageCode = clean(process.env.SHIPSTATION_LETTER_PACKAGE_CODE) || "letter";
  const parcelPackageCode = clean(process.env.SHIPSTATION_PARCEL_PACKAGE_CODE) || "package";

  const emptyResult = (): ShipStationConnectionTestResult => ({
    ok: false,
    apiKeyConfigured: false,
    apiProduct: "ShipStation API (formerly ShipEngine)",
    configuredCarrierId: carrierId,
    configuredCarrierFound: false,
    recommendedCarrierId: null,
    carriers: [],
    services: [],
    packages: [],
    requiredServices: {
      letter: { code: letterCode, available: null },
      groundAdvantage: { code: groundCode, available: null },
      priorityMail: { code: priorityCode, available: null },
    },
    requiredPackages: {
      letter: { code: letterPackageCode, available: null },
      parcel: { code: parcelPackageCode, available: null },
    },
    postagePurchaseAttempted: false,
    message:
      "SHIPSTATION_API_KEY is not configured. No provider request and no postage purchase were attempted.",
  });

  if (!apiKey) return emptyResult();

  const carrierPayload = await shipStationGet("/v1/carriers", apiKey);
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
  const recommendedCarrierId = configuredCarrierFound
    ? carrierId
    : preferredUspsCarrier(carriers);

  let services: ShipStationServiceSummary[] = [];
  let packages: ShipStationPackageSummary[] = [];

  if (recommendedCarrierId) {
    const [servicePayload, packagePayload] = await Promise.all([
      shipStationGet(
        `/v1/carriers/${encodeURIComponent(recommendedCarrierId)}/services`,
        apiKey,
      ),
      shipStationGet(
        `/v1/carriers/${encodeURIComponent(recommendedCarrierId)}/packages`,
        apiKey,
      ),
    ]);

    services = Array.isArray(servicePayload?.services)
      ? servicePayload.services
          .map((row: Record<string, unknown>) => ({
            serviceCode: clean(row.service_code),
            name: clean(row.name) || clean(row.service_code) || "Service",
            domestic: typeof row.domestic === "boolean" ? row.domestic : null,
            international:
              typeof row.international === "boolean" ? row.international : null,
          }))
          .filter((row: ShipStationServiceSummary) => row.serviceCode)
      : [];

    packages = Array.isArray(packagePayload?.packages)
      ? packagePayload.packages
          .map((row: Record<string, unknown>) => ({
            packageCode: clean(row.package_code),
            name: clean(row.name) || clean(row.package_code) || "Package",
          }))
          .filter((row: ShipStationPackageSummary) => row.packageCode)
      : [];
  }

  const serviceCodes = new Set(services.map((service) => service.serviceCode));
  const packageCodes = new Set(packages.map((pkg) => pkg.packageCode));
  const serviceAvailability = (code: string) =>
    recommendedCarrierId ? serviceCodes.has(code) : null;
  const packageAvailability = (code: string) =>
    recommendedCarrierId ? packageCodes.has(code) : null;

  const requiredServices = {
    letter: { code: letterCode, available: serviceAvailability(letterCode) },
    groundAdvantage: { code: groundCode, available: serviceAvailability(groundCode) },
    priorityMail: { code: priorityCode, available: serviceAvailability(priorityCode) },
  };
  const requiredPackages = {
    letter: { code: letterPackageCode, available: packageAvailability(letterPackageCode) },
    parcel: { code: parcelPackageCode, available: packageAvailability(parcelPackageCode) },
  };
  const allServicesAvailable = Object.values(requiredServices).every(
    (service) => service.available === true,
  );
  const allPackagesAvailable = Object.values(requiredPackages).every(
    (pkg) => pkg.available === true,
  );
  const ok = Boolean(recommendedCarrierId) && allServicesAvailable && allPackagesAvailable;

  return {
    ok,
    apiKeyConfigured: true,
    apiProduct: "ShipStation API (formerly ShipEngine)",
    configuredCarrierId: carrierId,
    configuredCarrierFound,
    recommendedCarrierId,
    carriers,
    services,
    packages,
    requiredServices,
    requiredPackages,
    postagePurchaseAttempted: false,
    message:
      carriers.length === 0
        ? "The standalone ShipStation API key authenticated, but no connected carriers were returned."
        : !recommendedCarrierId
          ? "The standalone ShipStation API key authenticated. Configure the USPS carrier ID shown below before enabling purchase."
          : !allServicesAvailable
            ? "ShipStation API authenticated, but one or more required USPS services are unavailable on the configured carrier."
            : !allPackagesAvailable
              ? "ShipStation API authenticated, but one or more required USPS package codes are unavailable on the configured carrier."
              : "Standalone ShipStation API authenticated. USPS First-Class Mail, Ground Advantage, Priority Mail, letter/package types, and the configured carrier are ready. No postage was purchased.",
  };
}
