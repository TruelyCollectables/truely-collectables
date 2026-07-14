import {
  getShippingProviderAdapterProfile,
  type ShippingProviderAdapterProfile,
} from "./shipping-provider-adapter";
import {
  getShippingProviderReadiness,
  shippingProviderSummary,
} from "./shipping-provider-readiness";

export type ProviderSetupLane = {
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

export type ProviderSetupDecision = {
  status:
    | "dry_run_only"
    | "needs_provider_setup"
    | "live_blocked"
    | "ready_for_live_adapter_build";
  summary: string;
  nextAction: string;
  blockers: string[];
};

export type StandardEnvelopeEvidenceContract = {
  lane: "STANDARD_ENVELOPE";
  evidenceProvider: "LetterTrack / USPS IMb";
  evidencePurpose: string;
  trackableRequirement: string;
  under20ProtectionModel: string;
  sellerOptInRule: string;
  reserveRate: "2%";
  itemReimbursementCap: "$20.00";
  reimbursementBasis: "item_sale_amount_excluding_shipping";
  reimbursesShipping: "no";
  notInsuranceNotice: string;
  operatorHandoff: string[];
};

export type LiveShippingRequirement = {
  key: string;
  label: string;
  status: "ready" | "blocked";
  detail: string;
  action: string;
  evidence: string[];
};

export type ProviderCredentialGroup = {
  title: string;
  note: string;
  keys: string[];
  requirement: string;
  status: "ready" | "missing";
  configuredKeys: string[];
  missingKeys: string[];
};

export type ProviderSetupActionPlanStep = {
  order: number;
  title: string;
  status: "ready" | "blocked" | "guarded";
  detail: string;
  action: string;
  evidence: string[];
};

export type ProviderSetupPacket = {
  exportedAt: string;
  scope: "tcos_shipping_provider_setup_no_secret_values";
  warning: string;
  decision: ProviderSetupDecision;
  liveRequirements: LiveShippingRequirement[];
  credentialGroups: ProviderCredentialGroup[];
  actionPlan: ProviderSetupActionPlanStep[];
  standardEnvelopeEvidenceContract: StandardEnvelopeEvidenceContract;
  standardEnvelopeEvidenceContractReady: boolean;
  readinessSummary: ReturnType<typeof shippingProviderSummary>;
  readiness: ReturnType<typeof getShippingProviderReadiness>;
  lanes: ProviderSetupLane[];
};

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

function providerSetupDecision(params: {
  lanes: ProviderSetupLane[];
  readiness: ReturnType<typeof getShippingProviderReadiness>;
  liveRequirements: LiveShippingRequirement[];
}): ProviderSetupDecision {
  const missing = Array.from(
    new Set(params.lanes.flatMap((lane) => lane.missingCredentialKeys)),
  );
  const liveRequirementBlockers = params.liveRequirements
    .filter((requirement) => requirement.status !== "ready")
    .map((requirement) => requirement.label);
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
        .flatMap((item) =>
          item.missing.length > 0 ? item.missing : [item.label],
        )
        .concat(liveRequirementBlockers),
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
      blockers: liveRequirementBlockers,
    };
  }

  return {
    status: "ready_for_live_adapter_build",
    summary:
      "Provider credential groups appear staged, but TCOS still requires an approved live adapter implementation before money-moving shipping calls are allowed.",
    nextAction:
      "Implement the live adapter behind the existing contract with quote, buy, void, Coverage purchase, webhook reconciliation, and audit-packet proof.",
    blockers: liveRequirementBlockers,
  };
}

function flagEnabled(key: string) {
  return process.env[key] === "true";
}

function secretConfigured(key: string) {
  return Boolean(process.env[key]?.trim());
}

const providerCredentialGroupDefinitions = [
  {
    title: "Standard Envelope / IMb provider account",
    note: "LetterTrack is the current Standard Envelope / USPS IMb handoff path. Set either the provider name or the explicit account-configured flag.",
    keys: ["TCOS_STANDARD_ENVELOPE_PROVIDER", "LETTERTRACK_ACCOUNT_CONFIGURED"],
  },
  {
    title: "Standard Envelope / IMb integration proof",
    note: "Approve the LetterTrack CSV import workflow now, or configure a future IMb provider API key when a true API adapter is selected.",
    keys: [
      "LETTERTRACK_IMPORT_WORKFLOW_APPROVED",
      "TCOS_STANDARD_ENVELOPE_API_KEY",
      "IMB_PROVIDER_API_KEY",
    ],
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

export const STANDARD_ENVELOPE_EVIDENCE_CONTRACT: StandardEnvelopeEvidenceContract =
  {
    lane: "STANDARD_ENVELOPE",
    evidenceProvider: "LetterTrack / USPS IMb",
    evidencePurpose:
      "Provides trackable USPS IMb delivery evidence for Standard Envelope card shipments.",
    trackableRequirement:
      "TCOS only needs provider evidence that can show delivered, not a parcel-level insurance policy.",
    under20ProtectionModel:
      "TCOS Under-$20 Seller Protection is an optional internal seller program for eligible Standard Envelope card shipments.",
    sellerOptInRule:
      "Seller must opt in per shipment; otherwise the seller remains responsible for buyer refund liability if delivery evidence does not satisfy TCOS rules.",
    reserveRate: "2%",
    itemReimbursementCap: "$20.00",
    reimbursementBasis: "item_sale_amount_excluding_shipping",
    reimbursesShipping: "no",
    notInsuranceNotice:
      "LetterTrack / USPS IMb is delivery-evidence tracking for this lane; TCOS Under-$20 Seller Protection is internal and is not third-party insurance.",
    operatorHandoff: [
      "Export eligible Standard Envelope rows to LetterTrack CSV.",
      "Import/print in LetterTrack and record the assigned IMb back into TCOS.",
      "Record LetterTrack delivery evidence before deciding under-$20 seller-protection payout.",
      "Refund the buyer first and document refund evidence before reimbursing an opted-in seller.",
    ],
  };

export function isStandardEnvelopeEvidenceContractReady(
  contract: StandardEnvelopeEvidenceContract,
) {
  return (
    contract.evidenceProvider === "LetterTrack / USPS IMb" &&
    contract.trackableRequirement.includes("show delivered") &&
    contract.under20ProtectionModel.includes("optional internal seller program") &&
    contract.sellerOptInRule.includes("Seller must opt in per shipment") &&
    contract.reserveRate === "2%" &&
    contract.itemReimbursementCap === "$20.00" &&
    contract.reimbursementBasis === "item_sale_amount_excluding_shipping" &&
    contract.reimbursesShipping === "no" &&
    contract.notInsuranceNotice.includes("not third-party insurance")
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function providerCredentialGroupStatus(
  lanes: ProviderSetupLane[],
): ProviderCredentialGroup[] {
  const configuredKeys = unique(
    lanes.flatMap((lane) => [
      ...lane.configuredCredentialKeys,
      ...lane.configuredCoverageCredentialKeys,
    ]),
  );

  return providerCredentialGroupDefinitions.map((group) => {
    const configuredGroupKeys = group.keys.filter((key) =>
      configuredKeys.includes(key),
    );

    return {
      title: group.title,
      note: group.note,
      keys: [...group.keys],
      requirement:
        group.keys.length > 1
          ? `Choose one of: ${group.keys.join(" or ")}`
          : "Required",
      status: configuredGroupKeys.length > 0 ? "ready" : "missing",
      configuredKeys: configuredGroupKeys,
      missingKeys: configuredGroupKeys.length > 0 ? [] : [...group.keys],
    };
  });
}

function liveShippingRequirements(params: {
  lanes: ProviderSetupLane[];
}): LiveShippingRequirement[] {
  const liveAdapterSupported = params.lanes.some(
    (lane) =>
      lane.adapterKey !== "shipment_coverage" && lane.livePurchaseSupported,
  );
  const allProviderCredentialsConfigured = params.lanes.every(
    (lane) => lane.missingCredentialKeys.length === 0,
  );
  const webhookConfigured =
    secretConfigured("TCOS_SHIPPING_PROVIDER_WEBHOOK_SECRET") ||
    secretConfigured("EASYPOST_WEBHOOK_SECRET") ||
    secretConfigured("SHIPPO_WEBHOOK_SECRET");

  return [
    {
      key: "provider_credentials",
      label: "Provider Credentials",
      status: allProviderCredentialsConfigured ? "ready" : "blocked",
      detail: allProviderCredentialsConfigured
        ? "All Standard Envelope, parcel-label, and Coverage credential groups are staged by secret name."
        : "One or more Standard Envelope, parcel-label, or Coverage credential groups are missing.",
      action:
        "Finish provider secret setup before live adapter approval. Do not export secret values.",
      evidence: params.lanes.flatMap((lane) => [
        `${lane.lane}: ${lane.missingCredentialKeys.length === 0 ? "credential groups staged" : `missing ${lane.missingCredentialKeys.join(", ")}`}`,
      ]),
    },
    {
      key: "live_adapter_implementation",
      label: "Live Adapter Implementation",
      status:
        liveAdapterSupported && flagEnabled("TCOS_LIVE_SHIPPING_ADAPTER_APPROVED")
          ? "ready"
          : "blocked",
      detail:
        "The live adapter must quote, buy, void, purchase Coverage, store provider IDs, and fail closed without using dry-run references.",
      action:
        "Implement and approve the live adapter before setting TCOS_SHIPPING_PURCHASE_MODE=live.",
      evidence: [
        "TCOS_LIVE_SHIPPING_ADAPTER_APPROVED=true",
        `adapter livePurchaseSupported=${liveAdapterSupported}`,
      ],
    },
    {
      key: "quote_buy_void_tests",
      label: "Quote / Buy / Void Tests",
      status: flagEnabled("TCOS_LIVE_SHIPPING_LABEL_TESTS_PASSED")
        ? "ready"
        : "blocked",
      detail:
        "Standard Envelope and parcel labels need test-mode quote, buy, print/download, void, duplicate prevention, and idempotency evidence.",
      action:
        "Run LetterTrack CSV import/IMb recording tests plus provider parcel-label scenarios, then set TCOS_LIVE_SHIPPING_LABEL_TESTS_PASSED only after evidence is saved.",
      evidence: ["TCOS_LIVE_SHIPPING_LABEL_TESTS_PASSED=true"],
    },
    {
      key: "coverage_purchase_tests",
      label: "Coverage Purchase Tests",
      status: flagEnabled("TCOS_LIVE_SHIPPING_COVERAGE_TESTS_PASSED")
        ? "ready"
        : "blocked",
      detail:
        "Coverage purchase, cancellation/void handoff, claim packet evidence, and seller-protection status updates need test evidence.",
      action:
        "Run Coverage provider test-mode scenarios and save evidence before live shipping approval.",
      evidence: ["TCOS_LIVE_SHIPPING_COVERAGE_TESTS_PASSED=true"],
    },
    {
      key: "webhook_reconciliation",
      label: "Webhook + Reconciliation",
      status:
        webhookConfigured &&
        flagEnabled("TCOS_LIVE_SHIPPING_RECONCILIATION_APPROVED")
          ? "ready"
          : "blocked",
      detail:
        "Provider webhook signing, event ingestion, tracking/void reconciliation, and unmatched-money/admin alerts must be configured.",
      action:
        "Configure shipping provider webhook secrets and approve daily shipping reconciliation before live mode.",
      evidence: [
        "TCOS_SHIPPING_PROVIDER_WEBHOOK_SECRET or provider webhook secret configured",
        "TCOS_LIVE_SHIPPING_RECONCILIATION_APPROVED=true",
      ],
    },
    {
      key: "simulation_suite",
      label: "Simulation Suite",
      status: flagEnabled("TCOS_LIVE_SHIPPING_SIMULATIONS_PASSED")
        ? "ready"
        : "blocked",
      detail:
        "TCOS shipping simulations must pass all sixteen Standard Envelope, Ground Advantage, Coverage, under-$20 seller-protection cap/allocation, LetterTrack CSV/evidence-review audit, adapter-profile, and dry-run guardrail assertions.",
      action:
        "Run /admin/shipping/simulations or npm run simulate:shipping after adapter work and save the pass evidence.",
      evidence: ["TCOS_LIVE_SHIPPING_SIMULATIONS_PASSED=true"],
    },
    {
      key: "admin_approval",
      label: "Admin Live Shipping Approval",
      status: flagEnabled("TCOS_LIVE_SHIPPING_ADMIN_APPROVED")
        ? "ready"
        : "blocked",
      detail:
        "A human admin approval must confirm provider terms, pricing, refunds/voids, Coverage behavior, and operational support before live labels.",
      action:
        "Set TCOS_LIVE_SHIPPING_ADMIN_APPROVED only after the live-shipping launch checklist is signed off.",
      evidence: ["TCOS_LIVE_SHIPPING_ADMIN_APPROVED=true"],
    },
  ];
}

function providerSetupActionPlan(params: {
  decision: ProviderSetupDecision;
  credentialGroups: ProviderCredentialGroup[];
  liveRequirements: LiveShippingRequirement[];
}): ProviderSetupActionPlanStep[] {
  const missingGroups = params.credentialGroups.filter(
    (group) => group.status === "missing",
  );
  const blockedLiveRequirements = params.liveRequirements.filter(
    (requirement) => requirement.status !== "ready",
  );
  const credentialsReady = missingGroups.length === 0;
  const liveEvidenceReady = blockedLiveRequirements.length === 0;

  return [
    {
      order: 1,
      title: "Choose provider accounts",
      status: credentialsReady ? "ready" : "blocked",
      detail:
        "Pick the approved Standard Envelope / IMb, parcel-label, and shipment Coverage provider paths before live adapter work.",
      action:
        "Use the provider checklist to decide which alternative key in each credential group TCOS should use.",
      evidence: missingGroups.length
        ? missingGroups.map(
            (group) => `${group.title}: ${group.requirement}`,
          )
        : ["All provider credential groups are staged by secret name."],
    },
    {
      order: 2,
      title: "Stage Vercel environment names",
      status: credentialsReady ? "ready" : "blocked",
      detail:
        "Store provider values only in Vercel environment variables. The TCOS exports list names and commands only, never secret values.",
      action:
        "Download the env template and Vercel commands export, then add the selected provider keys in Vercel production/preview.",
      evidence: missingGroups.length
        ? missingGroups.flatMap((group) => group.missingKeys)
        : ["No missing provider credential groups in the current environment."],
    },
    {
      order: 3,
      title: "Keep shipping runtime locked",
      status: "guarded",
      detail:
        "Provider credentials are not permission to buy postage. TCOS must stay in dry_run with live shipping disabled until adapter evidence and admin approval are complete.",
      action:
        "Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run and TCOS_LIVE_SHIPPING_ENABLED=false while setup is in progress.",
      evidence: [
        "TCOS_SHIPPING_PURCHASE_MODE=dry_run",
        "TCOS_LIVE_SHIPPING_ENABLED=false",
      ],
    },
    {
      order: 4,
      title: "Prove live adapter evidence",
      status: liveEvidenceReady ? "ready" : "blocked",
      detail:
        "The live adapter must quote, buy, void, purchase Coverage, reconcile webhooks, and preserve audit packets before any money-moving provider call.",
      action:
        "Complete every blocked live adapter requirement, then save the evidence before requesting approval.",
      evidence: blockedLiveRequirements.length
        ? blockedLiveRequirements.map(
            (requirement) => `${requirement.label}: ${requirement.action}`,
          )
        : ["All live adapter evidence requirements are marked ready."],
    },
    {
      order: 5,
      title: "Approve, deploy, and smoke",
      status:
        params.decision.status === "ready_for_live_adapter_build" &&
        liveEvidenceReady
          ? "ready"
          : "blocked",
      detail:
        "Only after provider setup, adapter evidence, simulations, webhooks, reconciliation, and admin approval are ready should live shipping be unlocked.",
      action:
        "Use the Live Shipping Gate, run verify/launch, and require production smoke to pass on the clean domain.",
      evidence: [
        "Admin Live Shipping Approval ready",
        "npm run verify:production",
        "npm run smoke:production",
      ],
    },
  ];
}

export function buildShippingProviderSetupPacket(): ProviderSetupPacket {
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
  const liveRequirements = liveShippingRequirements({ lanes });
  const credentialGroups = providerCredentialGroupStatus(lanes);
  const standardEnvelopeEvidenceContract = STANDARD_ENVELOPE_EVIDENCE_CONTRACT;
  const decision = providerSetupDecision({
    lanes,
    readiness,
    liveRequirements,
  });
  const actionPlan = providerSetupActionPlan({
    decision,
    credentialGroups,
    liveRequirements,
  });

  return {
    exportedAt: new Date().toISOString(),
    scope: "tcos_shipping_provider_setup_no_secret_values",
    warning:
      "This packet includes secret names and configuration status only. It does not include secret values and does not contact live providers.",
    decision,
    liveRequirements,
    credentialGroups,
    actionPlan,
    standardEnvelopeEvidenceContract,
    standardEnvelopeEvidenceContractReady:
      isStandardEnvelopeEvidenceContractReady(standardEnvelopeEvidenceContract),
    readinessSummary: shippingProviderSummary(readiness),
    readiness,
    lanes,
  };
}
