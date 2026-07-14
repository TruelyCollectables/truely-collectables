import {
  buildShippingProviderSetupPacket,
  type LiveShippingRequirement,
  type ProviderCredentialGroup,
  type ProviderSetupDecision,
  type ProviderSetupLane,
  type StandardEnvelopeEvidenceContract,
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
  standardEnvelopeEvidenceContract: StandardEnvelopeEvidenceContract;
  standardEnvelopeEvidenceContractReady: boolean;
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
    "standardEnvelopeEvidenceProvider",
    "standardEnvelopeTrackableRequirement",
    "under20ProtectionModel",
    "under20ProtectionNotInsurance",
    "under20ProtectionReserveRate",
    "under20ProtectionReimbursesShipping",
    "standardEnvelopeEvidenceContractReady",
  ] as const;
  const decision = {
    decisionStatus: params.decision.status,
    decisionSummary: params.decision.summary,
    decisionNextAction: params.decision.nextAction,
    decisionBlockers: params.decision.blockers,
    liveRequirementBlockers: params.liveRequirements
      .filter((requirement) => requirement.status !== "ready")
      .map((requirement) => requirement.label),
    standardEnvelopeEvidenceProvider:
      params.standardEnvelopeEvidenceContract.evidenceProvider,
    standardEnvelopeTrackableRequirement:
      params.standardEnvelopeEvidenceContract.trackableRequirement,
    under20ProtectionModel:
      params.standardEnvelopeEvidenceContract.under20ProtectionModel,
    under20ProtectionNotInsurance:
      params.standardEnvelopeEvidenceContract.notInsuranceNotice,
    under20ProtectionReserveRate:
      params.standardEnvelopeEvidenceContract.reserveRate,
    under20ProtectionReimbursesShipping:
      params.standardEnvelopeEvidenceContract.reimbursesShipping,
    standardEnvelopeEvidenceContractReady:
      params.standardEnvelopeEvidenceContractReady,
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

function exportLinks(requestUrl: string) {
  const url = new URL(requestUrl);
  const base = `${url.origin}${url.pathname}`;

  return {
    json: base,
    csv: `${base}?format=csv`,
    envTemplate: `${base}?format=env-template`,
    vercelCommands: `${base}?format=vercel-commands`,
    operatorChecklist: `${base}?format=operator-checklist`,
  };
}

function envTemplateResponse(params: {
  credentialGroups: ProviderCredentialGroup[];
  lanes: ProviderSetupLane[];
  decision: ProviderSetupDecision;
  liveRequirements: LiveShippingRequirement[];
  standardEnvelopeEvidenceContract: StandardEnvelopeEvidenceContract;
  standardEnvelopeEvidenceContractReady: boolean;
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
  const credentialGroupLines = params.credentialGroups.flatMap((group) => [
    `# ${group.title}`,
    `# ${group.note}`,
    `# ${group.requirement}`,
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
    "# Standard Envelope evidence/protection contract",
    `# Runtime gate validator: ${params.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}`,
    `# Evidence provider: ${params.standardEnvelopeEvidenceContract.evidenceProvider}`,
    `# Trackable requirement: ${params.standardEnvelopeEvidenceContract.trackableRequirement}`,
    `# Under-$20 protection model: ${params.standardEnvelopeEvidenceContract.under20ProtectionModel}`,
    `# Seller opt-in rule: ${params.standardEnvelopeEvidenceContract.sellerOptInRule}`,
    `# Reserve rate: ${params.standardEnvelopeEvidenceContract.reserveRate}`,
    `# Item reimbursement cap: ${params.standardEnvelopeEvidenceContract.itemReimbursementCap}`,
    `# Reimbursement basis: ${params.standardEnvelopeEvidenceContract.reimbursementBasis}`,
    `# Reimburses shipping: ${params.standardEnvelopeEvidenceContract.reimbursesShipping}`,
    `# Not insurance: ${params.standardEnvelopeEvidenceContract.notInsuranceNotice}`,
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

function vercelCommandsResponse(params: {
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
  const liveRequirementKeys = unique(
    params.liveRequirements.flatMap((requirement) => requirement.evidence),
  )
    .filter((evidence) => /^[A-Z0-9_]+=(true|false)$/i.test(evidence))
    .map((evidence) => evidence.split("=")[0]);
  const webhookKeys = [
    "TCOS_SHIPPING_PROVIDER_WEBHOOK_SECRET",
    "EASYPOST_WEBHOOK_SECRET",
    "SHIPPO_WEBHOOK_SECRET",
  ];
  const commandKeys = unique([
    "TCOS_SHIPPING_PURCHASE_MODE",
    "TCOS_LIVE_SHIPPING_ENABLED",
    ...requiredCredentialKeys,
    ...webhookKeys,
    ...liveRequirementKeys,
  ]);
  const lines = [
    "# TCOS shipping provider Vercel env command checklist",
    "# These commands prompt for values. They do not contain secret values.",
    "# Use the provider groups in the env-template export to decide which alternatives to set.",
    `# Provider decision: ${params.decision.status}`,
    `# Next action: ${params.decision.nextAction}`,
    "",
    "# Production environment",
    ...commandKeys.map(
      (key) => `vercel env add ${key} production --scope truelycollectables-projects`,
    ),
    "",
    "# Preview environment, if you want the same staged shape before the next deploy",
    ...commandKeys.map(
      (key) => `vercel env add ${key} preview --scope truelycollectables-projects`,
    ),
    "",
    "# After env changes, redeploy when the deployment quota is available.",
    "",
  ];
  const exportedAt = new Date().toISOString().slice(0, 10);

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="tcos-shipping-provider-vercel-env-${exportedAt}.sh"`,
      "Cache-Control": "no-store",
    },
  });
}

function operatorChecklistResponse(params: {
  credentialGroups: ProviderCredentialGroup[];
  lanes: ProviderSetupLane[];
  decision: ProviderSetupDecision;
  liveRequirements: LiveShippingRequirement[];
  standardEnvelopeEvidenceContract: StandardEnvelopeEvidenceContract;
  standardEnvelopeEvidenceContractReady: boolean;
}) {
  const missingCredentialGroups = unique(
    params.lanes.flatMap((lane) => [
      ...lane.missingCredentialKeys,
      ...lane.missingCoverageCredentialKeys,
    ]),
  );
  const blockedRequirements = params.liveRequirements.filter(
    (requirement) => requirement.status !== "ready",
  );
  const lines = [
    "# TCOS Shipping Provider Operator Checklist",
    "",
    "This checklist contains names, decisions, and evidence requirements only. It must not include provider secret values.",
    "",
    "## Current Verdict",
    "",
    `- Status: ${params.decision.status}`,
    `- Summary: ${params.decision.summary}`,
    `- Next action: ${params.decision.nextAction}`,
    "",
    "## Standard Envelope Evidence + Under-$20 Protection Contract",
    "",
    `- Runtime gate validator: ${params.standardEnvelopeEvidenceContractReady ? "ready" : "blocked"}`,
    `- Evidence provider: ${params.standardEnvelopeEvidenceContract.evidenceProvider}`,
    `- Evidence purpose: ${params.standardEnvelopeEvidenceContract.evidencePurpose}`,
    `- Trackable requirement: ${params.standardEnvelopeEvidenceContract.trackableRequirement}`,
    `- Under-$20 protection model: ${params.standardEnvelopeEvidenceContract.under20ProtectionModel}`,
    `- Seller opt-in rule: ${params.standardEnvelopeEvidenceContract.sellerOptInRule}`,
    `- Reserve rate: ${params.standardEnvelopeEvidenceContract.reserveRate}`,
    `- Item reimbursement cap: ${params.standardEnvelopeEvidenceContract.itemReimbursementCap}`,
    `- Reimbursement basis: ${params.standardEnvelopeEvidenceContract.reimbursementBasis}`,
    `- Reimburses shipping: ${params.standardEnvelopeEvidenceContract.reimbursesShipping}`,
    `- Not insurance: ${params.standardEnvelopeEvidenceContract.notInsuranceNotice}`,
    "",
    "### Operator Handoff",
    "",
    ...params.standardEnvelopeEvidenceContract.operatorHandoff.map(
      (step) => `- ${step}`,
    ),
    "",
    "## Provider Credentials To Gather",
    "",
    ...params.credentialGroups.flatMap((group) => [
      `### ${group.title}`,
      "",
      `- ${group.note}`,
      `- ${group.requirement}.`,
      "- Confirm the provider account is production/live-capable before storing the key.",
      "",
    ]),
    "## Missing Credential Groups Right Now",
    "",
    ...(missingCredentialGroups.length > 0
      ? missingCredentialGroups.map((group) => `- ${group}`)
      : ["- None"]),
    "",
    "## Live Adapter Evidence Still Required",
    "",
    ...(blockedRequirements.length > 0
      ? blockedRequirements.flatMap((requirement) => [
          `### ${requirement.label}`,
          "",
          `- Detail: ${requirement.detail}`,
          `- Action: ${requirement.action}`,
          ...requirement.evidence.map((evidence) => `- Evidence: ${evidence}`),
          "",
        ])
      : ["- All live adapter requirements are marked ready.", ""]),
    "## Keep Locked Until Approved",
    "",
    "- Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run while gathering credentials.",
    "- Keep TCOS_LIVE_SHIPPING_ENABLED=false until provider credentials, adapter implementation, simulations, webhooks, reconciliation, and admin approval are complete.",
    "- Do not paste secret values into Git, chat, screenshots, tickets, or exported packets.",
    "",
  ];
  const exportedAt = new Date().toISOString().slice(0, 10);

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="tcos-shipping-provider-operator-checklist-${exportedAt}.md"`,
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
        standardEnvelopeEvidenceContract:
          packet.standardEnvelopeEvidenceContract,
        standardEnvelopeEvidenceContractReady:
          packet.standardEnvelopeEvidenceContractReady,
      });
    }

    if (url.searchParams.get("format") === "env-template") {
      return envTemplateResponse({
        credentialGroups: packet.credentialGroups,
        lanes: packet.lanes,
        decision: packet.decision,
        liveRequirements: packet.liveRequirements,
        standardEnvelopeEvidenceContract:
          packet.standardEnvelopeEvidenceContract,
        standardEnvelopeEvidenceContractReady:
          packet.standardEnvelopeEvidenceContractReady,
      });
    }

    if (url.searchParams.get("format") === "vercel-commands") {
      return vercelCommandsResponse({
        lanes: packet.lanes,
        decision: packet.decision,
        liveRequirements: packet.liveRequirements,
      });
    }

    if (url.searchParams.get("format") === "operator-checklist") {
      return operatorChecklistResponse({
        credentialGroups: packet.credentialGroups,
        lanes: packet.lanes,
        decision: packet.decision,
        liveRequirements: packet.liveRequirements,
        standardEnvelopeEvidenceContract:
          packet.standardEnvelopeEvidenceContract,
        standardEnvelopeEvidenceContractReady:
          packet.standardEnvelopeEvidenceContractReady,
      });
    }

    return Response.json(
      {
        ...packet,
        exports: exportLinks(request.url),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not build shipping provider setup." },
      { status: 500 },
    );
  }
}
