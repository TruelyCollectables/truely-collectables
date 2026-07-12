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
