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

type ProviderSetupDecision = {
  status:
    | "dry_run_only"
    | "needs_provider_setup"
    | "live_blocked"
    | "ready_for_live_adapter_build";
  summary: string;
  nextAction: string;
  blockers: string[];
};

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function providerSetupDecision(params: {
  lanes: ProviderSetupLane[];
  readiness: ReturnType<typeof getShippingProviderReadiness>;
}): ProviderSetupDecision {
  const missing = Array.from(
    new Set(params.lanes.flatMap((lane) => lane.missingCredentialKeys)),
  );
  const liveBlocked = params.readiness.some(
    (item) =>
      item.status === "blocked" &&
      ["shipping_purchase_mode", "shipping_adapter_contract"].includes(item.key),
  );
  const purchaseMode = params.lanes[0]?.purchaseMode || "dry_run";

  if (liveBlocked) {
    return {
      status: "live_blocked",
      summary:
        "Live shipping purchase mode is enabled, but TCOS intentionally blocks live postage/Coverage purchase because no live adapter is approved.",
      nextAction:
        "Switch TCOS_SHIPPING_PURCHASE_MODE back to dry_run or finish and approve a real live adapter before attempting provider purchase.",
      blockers: params.readiness
        .filter((item) => item.status === "blocked")
        .flatMap((item) => item.missing.length > 0 ? item.missing : [item.label]),
    };
  }

  if (missing.length > 0) {
    return {
      status: "needs_provider_setup",
      summary:
        "TCOS can plan and audit shipping, but provider setup is incomplete for one or more lanes.",
      nextAction:
        "Configure the missing Standard Envelope, parcel-label, and Coverage secret groups before requesting live adapter work.",
      blockers: missing,
    };
  }

  if (purchaseMode === "dry_run") {
    return {
      status: "dry_run_only",
      summary:
        "All provider credential groups appear staged, but TCOS remains in dry-run purchase mode and will not buy postage.",
      nextAction:
        "Keep dry_run until the live provider adapter is implemented, approved, and covered by simulations/reconciliation.",
      blockers: ["approved live adapter implementation"],
    };
  }

  return {
    status: "ready_for_live_adapter_build",
    summary:
      "Provider credential groups appear staged, but TCOS still requires an approved live adapter implementation before money-moving shipping calls are allowed.",
    nextAction:
      "Implement the live adapter behind the existing contract with quote, buy, void, Coverage purchase, webhook reconciliation, and audit-packet proof.",
    blockers: ["approved live adapter implementation"],
  };
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
  const decision = providerSetupDecision({ lanes, readiness });

  return {
    exportedAt: new Date().toISOString(),
    scope: "tcos_shipping_provider_setup_no_secret_values",
    warning:
      "This packet includes secret names and configuration status only. It does not include secret values and does not contact live providers.",
    decision,
    readinessSummary: shippingProviderSummary(readiness),
    readiness,
    lanes,
  };
}

function csvResponse(params: {
  lanes: ProviderSetupLane[];
  decision: ProviderSetupDecision;
}) {
  const headers = [
    "decisionStatus",
    "decisionSummary",
    "decisionNextAction",
    "decisionBlockers",
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
  const decision = {
    decisionStatus: params.decision.status,
    decisionSummary: params.decision.summary,
    decisionNextAction: params.decision.nextAction,
    decisionBlockers: params.decision.blockers,
  };
  const body = [
    headers.join(","),
    ...params.lanes.map((row) =>
      headers
        .map((header) =>
          csvCell(
            header in decision
              ? decision[header as keyof typeof decision]
              : row[header as keyof ProviderSetupLane],
          ),
        )
        .join(","),
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
      return csvResponse({
        lanes: packet.lanes,
        decision: packet.decision,
      });
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
