import {
  getShippingProviderAdapterProfile,
  type ShippingProviderAdapterProfile,
} from "../../../../../lib/shipping-provider-adapter";
import {
  getShippingProviderReadiness,
  shippingProviderSummary,
} from "../../../../../lib/shipping-provider-readiness";

export const dynamic = "force-dynamic";

type ProviderSetupLane = {
  lane: string;
  adapterKey: string;
  method: string;
  provider: string;
  service: string;
  carrier: string;
  purchaseMode: string;
  adapterStatus: string;
  livePurchaseSupported: boolean;
  liveBlockReason: string | null;
  credentialKeys: string[];
  configuredCredentialKeys: string[];
  missingCredentialKeys: string[];
  coverageProvider: string;
  coverageCredentialKeys: string[];
  configuredCoverageCredentialKeys: string[];
  missingCoverageCredentialKeys: string[];
  manualPurchaseRequired: boolean;
};

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function laneFromProfile(
  lane: string,
  profile: ShippingProviderAdapterProfile,
): ProviderSetupLane {
  return {
    lane,
    adapterKey: profile.adapterKey,
    method: profile.method,
    provider: profile.provider,
    service: profile.providerService,
    carrier: profile.carrier,
    purchaseMode: profile.purchaseMode,
    adapterStatus: profile.adapterStatus,
    livePurchaseSupported: profile.livePurchaseSupported,
    liveBlockReason: profile.liveBlockReason,
    credentialKeys: profile.credentialKeys,
    configuredCredentialKeys: profile.configuredCredentialKeys,
    missingCredentialKeys: profile.missingCredentialKeys,
    coverageProvider: profile.coverageProvider,
    coverageCredentialKeys: profile.coverageCredentialKeys,
    configuredCoverageCredentialKeys: profile.configuredCoverageCredentialKeys,
    missingCoverageCredentialKeys: profile.missingCoverageCredentialKeys,
    manualPurchaseRequired: profile.manualPurchaseRequired,
  };
}

function buildProviderSetupPacket() {
  const readiness = getShippingProviderReadiness();
  const standardEnvelopeProfile =
    getShippingProviderAdapterProfile("STANDARD_ENVELOPE");
  const groundAdvantageProfile =
    getShippingProviderAdapterProfile("GROUND_ADVANTAGE");
  const lanes = [
    laneFromProfile("Standard Envelope / IMb", standardEnvelopeProfile),
    laneFromProfile("Ground Advantage / Priority", groundAdvantageProfile),
    {
      ...laneFromProfile("Shipment Coverage", standardEnvelopeProfile),
      adapterKey: "shipment_coverage",
      method: "ALL_SHIPMENTS",
      provider: standardEnvelopeProfile.coverageProvider,
      service: "Seller shipment protection",
      carrier: "Carrier-dependent",
      credentialKeys: standardEnvelopeProfile.coverageCredentialKeys,
      configuredCredentialKeys:
        standardEnvelopeProfile.configuredCoverageCredentialKeys,
      missingCredentialKeys:
        standardEnvelopeProfile.missingCoverageCredentialKeys,
    },
  ];

  return {
    exportedAt: new Date().toISOString(),
    scope: "tcos_shipping_provider_setup_no_secret_values",
    warning:
      "This packet includes secret names and configuration status only. It does not include secret values and does not contact live providers.",
    readinessSummary: shippingProviderSummary(readiness),
    readiness,
    lanes,
  };
}

function csvResponse(lanes: ProviderSetupLane[]) {
  const headers = [
    "lane",
    "adapterKey",
    "method",
    "provider",
    "service",
    "carrier",
    "purchaseMode",
    "adapterStatus",
    "livePurchaseSupported",
    "liveBlockReason",
    "credentialKeys",
    "configuredCredentialKeys",
    "missingCredentialKeys",
    "coverageProvider",
    "coverageCredentialKeys",
    "configuredCoverageCredentialKeys",
    "missingCoverageCredentialKeys",
    "manualPurchaseRequired",
  ] as const;
  const body = [
    headers.join(","),
    ...lanes.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\r\n");
  const exportedAt = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tcos-shipping-provider-setup-${exportedAt}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const packet = buildProviderSetupPacket();
    const url = new URL(request.url);

    if (url.searchParams.get("format") === "csv") {
      return csvResponse(packet.lanes);
    }

    return Response.json(packet, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not build shipping provider setup." },
      { status: 500 },
    );
  }
}
