import {
  buildShippingProviderSetupPacket,
  type LiveShippingRequirement,
  type ProviderSetupDecision,
  type ProviderSetupLane,
} from "../../../../../lib/shipping-provider-setup";

export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csvResponse(params: {
  lanes: ProviderSetupLane[];
  decision: ProviderSetupDecision;
  liveRequirements: LiveShippingRequirement[];
}) {
  const headers = [
    "decisionStatus",
    "decisionSummary",
    "decisionNextAction",
    "decisionBlockers",
    "liveRequirementBlockers",
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
    liveRequirementBlockers: params.liveRequirements
      .filter((requirement) => requirement.status !== "ready")
      .map((requirement) => requirement.label),
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

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

const providerCredentialGroups = [
  {
    title: "Standard Envelope / IMb provider name",
    note: "Required for real Standard Envelope label purchase.",
    keys: ["TCOS_STANDARD_ENVELOPE_PROVIDER"],
  },
  {
    title: "Standard Envelope / IMb API key",
    note: "Choose the key name used by the approved Standard Envelope adapter.",
    keys: ["TCOS_STANDARD_ENVELOPE_API_KEY", "IMB_PROVIDER_API_KEY"],
  },
  {
    title: "Ground Advantage / Priority label provider",
    note: "Choose one provider path. EasyPost or Shippo tokens can infer the provider.",
    keys: ["TCOS_PARCEL_LABEL_PROVIDER", "EASYPOST_API_KEY", "SHIPPO_API_TOKEN"],
  },
  {
    title: "Shipment Coverage provider name",
    note: "Required before TCOS can purchase external seller shipment protection.",
    keys: ["TCOS_SHIPPING_COVERAGE_PROVIDER"],
  },
  {
    title: "Shipment Coverage API key",
    note: "Choose the key name used by the approved Coverage adapter.",
    keys: ["TCOS_SHIPPING_COVERAGE_API_KEY", "COVERAGE_API_KEY"],
  },
] as const;

function envTemplateResponse(params: {
  lanes: ProviderSetupLane[];
  decision: ProviderSetupDecision;
  liveRequirements: LiveShippingRequirement[];
}) {
  const requiredCredentialKeys = unique(
    params.lanes.flatMap((lane) => [
      ...lane.credentialKeys,
      ...lane.coverageCredentialKeys,
    ]),
  );
  const missingCredentialGroups = unique(
    params.lanes.flatMap((lane) => [
      ...lane.missingCredentialKeys,
      ...lane.missingCoverageCredentialKeys,
    ]),
  );
  const liveRequirementKeys = unique(
    params.liveRequirements.flatMap((requirement) => requirement.evidence),
  ).filter((evidence) => /^[A-Z0-9_]+=(true|false)$/i.test(evidence));
  const webhookKeys = [
    "TCOS_SHIPPING_PROVIDER_WEBHOOK_SECRET",
    "EASYPOST_WEBHOOK_SECRET",
    "SHIPPO_WEBHOOK_SECRET",
  ];
  const credentialGroupLines = providerCredentialGroups.flatMap((group) => [
    `# ${group.title}`,
    `# ${group.note}`,
    group.keys.length > 1
      ? `# Choose one of: ${group.keys.join(" or ")}`
      : "# Required",
    ...group.keys.map((key) => `${key}=`),
    "",
  ]);
  const lines = [
    "# TCOS shipping provider setup template",
    "# Paste these keys into Vercel production/preview environment variables.",
    "# Do not commit real secret values to git. This export contains names only.",
    `# Provider decision: ${params.decision.status}`,
    `# Next action: ${params.decision.nextAction}`,
    "",
    "# Safe shipping runtime defaults",
    "TCOS_SHIPPING_PURCHASE_MODE=dry_run",
    "TCOS_LIVE_SHIPPING_ENABLED=false",
    "",
    "# Provider credential groups",
    "# Single-key groups are required. Multi-key groups are alternatives; set the one your approved provider adapter uses.",
    ...credentialGroupLines,
    "# All supported credential key names, deduped",
    ...requiredCredentialKeys.map((key) => `# ${key}`),
    "",
    "# Provider webhook signing secret names; configure the one your provider uses",
    `# Choose one of: ${webhookKeys.join(" or ")}`,
    ...webhookKeys.map((key) => `${key}=`),
    "",
    "# Live adapter approval flags; keep false until evidence is saved",
    ...liveRequirementKeys.map((evidence) => evidence.replace("=true", "=false")),
    "",
    "# Missing credential groups right now",
    ...(missingCredentialGroups.length > 0
      ? missingCredentialGroups.map((group) => `# - ${group}`)
      : ["# - none"]),
    "",
  ];
  const exportedAt = new Date().toISOString().slice(0, 10);

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="tcos-shipping-provider-env-template-${exportedAt}.env"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const packet = buildShippingProviderSetupPacket();
    const url = new URL(request.url);

    if (url.searchParams.get("format") === "csv") {
      return csvResponse({
        lanes: packet.lanes,
        decision: packet.decision,
        liveRequirements: packet.liveRequirements,
      });
    }

    if (url.searchParams.get("format") === "env-template") {
      return envTemplateResponse({
        lanes: packet.lanes,
        decision: packet.decision,
        liveRequirements: packet.liveRequirements,
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
