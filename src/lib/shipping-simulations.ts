import {
  getUnder20SellerProtection,
  getShippingCoverage,
  resolveShippingMethod,
  standardEnvelopeRateForEstimatedOunces,
} from "./shipping";
import {
  getShippingProviderAdapterProfile,
  purchaseShippingLabel,
} from "./shipping-provider-adapter";
import { buildShippingProviderSetupPacket } from "./shipping-provider-setup";
import {
  buildLetterTrackExport,
  letterTrackCsvContent,
} from "./lettertrack-export";
import {
  buildLetterTrackSellerProtectionEvidenceReview,
  buildLetterTrackDeliveryEvidenceSummary,
  evaluateLetterTrackSellerProtectionPaymentGate,
  evaluateLetterTrackSellerProtectionPaymentMetadataGate,
  shouldRecordLetterTrackSellerProtectionEvidenceReview,
} from "./lettertrack-delivery-evidence";
import {
  buildUnder20SellerProtectionClaimSummary,
  buildUnder20SellerProtectionReimbursementPlan,
  buildUnder20SellerProtectionSellerVisibilitySummary,
  evaluateUnder20SellerProtectionBuyerRefundGate,
  evaluateUnder20SellerProtectionBuyerRefundMetadataGate,
} from "./under20-seller-protection-claims";

export const SHIPPING_SIMULATION_SUITE_VERSION = "2026-07-14.4";
export const SHIPPING_SIMULATION_EXPECTED_SCENARIO_KEYS = [
  "standard_envelope_under_20_and_3oz",
  "standard_envelope_over_20_forces_ground_advantage",
  "standard_envelope_over_3oz_forces_ground_advantage",
  "coverage_required_for_standard_and_ground",
  "under_20_seller_protection_opted_in_item_only",
  "under_20_seller_protection_not_opted_in_seller_liability",
  "under_20_seller_protection_caps_mixed_rows",
  "under_20_seller_protection_seller_order_visibility",
  "under_20_seller_protection_reimbursement_allocation",
  "under_20_seller_protection_buyer_refund_gate",
  "shipping_adapter_profiles_are_auditable",
  "lettertrack_standard_envelope_export",
  "lettertrack_csv_seller_protection_contract",
  "lettertrack_delivery_evidence_claim_review_rules",
  "lettertrack_seller_protection_paid_gate",
  "lettertrack_seller_protection_evidence_review_audit",
  "dry_run_standard_envelope_purchase",
  "dry_run_ground_advantage_purchase",
] as const;
export const SHIPPING_SIMULATION_EXPECTED_SCENARIO_COUNT =
  SHIPPING_SIMULATION_EXPECTED_SCENARIO_KEYS.length;

export type ShippingSimulationScenario = {
  scenario_key: string;
  scenario_status: "passed" | "failed";
  detail: string;
  assertions: Record<string, unknown>;
};

export type LiveShippingApprovalReport = {
  approval_status: "ready_to_request_live_mode" | "blocked";
  detail: string;
  next_action: string;
  provider_setup_status: string;
  purchase_mode: string;
  simulation_status: "passed" | "failed";
  requirements_ready_count: number;
  requirements_count: number;
  blockers: string[];
};

function pass(condition: boolean) {
  return condition ? "passed" : "failed";
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function runShippingSimulationSuite() {
  const scenarios: ShippingSimulationScenario[] = [];
  const providerSetup = buildShippingProviderSetupPacket();

  const standardEnvelope = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 3,
    subtotal: 19.99,
  });
  const standardEnvelopeRate = standardEnvelopeRateForEstimatedOunces({
    estimatedOunces: 3,
    now: new Date("2026-07-10T12:00:00.000Z"),
  });
  const currentStandardEnvelopeRate = standardEnvelopeRateForEstimatedOunces({
    estimatedOunces: 3,
  });
  scenarios.push({
    scenario_key: "standard_envelope_under_20_and_3oz",
    scenario_status: pass(
      standardEnvelope.method === "STANDARD_ENVELOPE" &&
        money(standardEnvelopeRate) === 1.32,
    ),
    detail:
      "A raw-card order at $19.99 and 3 estimated oz stays on Standard Envelope at the expected $1.32 pre-July-12 rate.",
    assertions: {
      resolved_method: standardEnvelope.method,
      estimated_ounces: standardEnvelope.standardEnvelope.estimatedOunces,
      postage_rate: standardEnvelopeRate,
      eligible: standardEnvelope.standardEnvelope.eligible,
    },
  });

  const overTwenty = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 1,
    subtotal: 20.01,
  });
  scenarios.push({
    scenario_key: "standard_envelope_over_20_forces_ground_advantage",
    scenario_status: pass(
      overTwenty.method === "GROUND_ADVANTAGE" &&
        overTwenty.standardEnvelope.eligible === false,
    ),
    detail:
      "A card order over $20.00 is forced from Standard Envelope to Ground Advantage.",
    assertions: {
      requested_method: overTwenty.requestedMethod,
      resolved_method: overTwenty.method,
      reason: overTwenty.reason,
    },
  });

  const overThreeOunces = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 4,
    subtotal: 19,
  });
  scenarios.push({
    scenario_key: "standard_envelope_over_3oz_forces_ground_advantage",
    scenario_status: pass(
      overThreeOunces.method === "GROUND_ADVANTAGE" &&
        overThreeOunces.standardEnvelope.estimatedOunces === 4,
    ),
    detail:
      "A raw-card order estimated above 3 oz is forced from Standard Envelope to Ground Advantage.",
    assertions: {
      requested_method: overThreeOunces.requestedMethod,
      resolved_method: overThreeOunces.method,
      estimated_ounces: overThreeOunces.standardEnvelope.estimatedOunces,
      reason: overThreeOunces.reason,
    },
  });

  const standardEnvelopeCoverage = getShippingCoverage({
    method: "STANDARD_ENVELOPE",
    subtotal: 19.99,
  });
  const groundCoverage = getShippingCoverage({
    method: "GROUND_ADVANTAGE",
    subtotal: 20.01,
  });
  scenarios.push({
    scenario_key: "coverage_required_for_standard_and_ground",
    scenario_status: pass(
      standardEnvelopeCoverage.required &&
        groundCoverage.required &&
        standardEnvelopeCoverage.sellerProtected &&
        groundCoverage.sellerProtected,
    ),
    detail:
      "Seller protection coverage is required for both Standard Envelope and Ground Advantage shipments.",
    assertions: {
      standard_envelope: standardEnvelopeCoverage,
      ground_advantage: groundCoverage,
    },
  });

  const optedInProtection = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 18.75,
    sellerOptedIn: true,
  });
  const optedInClaim = buildUnder20SellerProtectionClaimSummary([
    {
      id: "sim-ledger-protected",
      gross_item_amount: 18.75,
      shipping_allocated_amount: 1.07,
      metadata: {
        under_20_seller_protection: optedInProtection,
      },
    },
  ]);
  scenarios.push({
    scenario_key: "under_20_seller_protection_opted_in_item_only",
    scenario_status: pass(
      optedInProtection.eligible &&
        optedInProtection.feeAmount === 0.38 &&
        optedInClaim.reimbursableItemAmount === 18.75 &&
        optedInClaim.reimbursesShipping === false &&
        optedInClaim.shippingExcludedAmount === 1.07,
    ),
    detail:
      "An opted-in under-$20 Standard Envelope sale withholds 2%, reimburses protected item amount only, and excludes shipping.",
    assertions: {
      protection: optedInProtection,
      claim: optedInClaim,
    },
  });

  const notOptedInProtection = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 18.75,
    sellerOptedIn: false,
  });
  const notOptedInClaim = buildUnder20SellerProtectionClaimSummary([
    {
      id: "sim-ledger-unprotected",
      gross_item_amount: 18.75,
      shipping_allocated_amount: 1.07,
      metadata: {
        under_20_seller_protection: notOptedInProtection,
      },
    },
  ]);
  scenarios.push({
    scenario_key: "under_20_seller_protection_not_opted_in_seller_liability",
    scenario_status: pass(
      !notOptedInProtection.eligible &&
        notOptedInProtection.feeAmount === 0 &&
        notOptedInClaim.reimbursableItemAmount === 0 &&
        notOptedInClaim.sellerOptedIn === false,
    ),
    detail:
      "A non-opted-in under-$20 Standard Envelope sale withholds no reserve, reimburses $0, and leaves refund liability with the seller.",
    assertions: {
      protection: notOptedInProtection,
      claim: notOptedInClaim,
    },
  });
  const cappedProtectedA = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 14.25,
    sellerOptedIn: true,
  });
  const cappedProtectedB = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 12.5,
    sellerOptedIn: true,
  });
  const cappedUnprotected = getUnder20SellerProtection({
    method: "STANDARD_ENVELOPE",
    subtotal: 6.75,
    sellerOptedIn: false,
  });
  const cappedRows = [
    {
      id: "sim-ledger-protected-a",
      order_item_id: 2001,
      seller_account_id: "seller-a",
      gross_item_amount: 14.25,
      shipping_allocated_amount: 0.78,
      metadata: {
        under_20_seller_protection: cappedProtectedA,
      },
    },
    {
      id: "sim-ledger-protected-b",
      order_item_id: 2002,
      seller_account_id: "seller-b",
      gross_item_amount: 12.5,
      shipping_allocated_amount: 0.58,
      metadata: {
        under_20_seller_protection: cappedProtectedB,
      },
    },
    {
      id: "sim-ledger-unprotected-mixed",
      order_item_id: 2003,
      seller_account_id: "seller-c",
      gross_item_amount: 6.75,
      shipping_allocated_amount: 0.23,
      metadata: {
        under_20_seller_protection: cappedUnprotected,
      },
    },
  ];
  const cappedClaim = buildUnder20SellerProtectionClaimSummary(cappedRows);
  scenarios.push({
    scenario_key: "under_20_seller_protection_caps_mixed_rows",
    scenario_status: pass(
      cappedClaim.protectedItemAmount === 26.75 &&
        cappedClaim.reimbursableItemAmount === 20 &&
        cappedClaim.shippingExcludedAmount === 1.36 &&
        cappedClaim.protectedLedgerEntryIds.length === 2 &&
        cappedClaim.unprotectedLedgerEntryIds.includes(
          "sim-ledger-unprotected-mixed",
        ) &&
        cappedClaim.reimbursesShipping === false,
    ),
    detail:
      "Mixed under-$20 claim rows cap reimbursement at $20, include only opted-in protected item amounts, track excluded shipping, and leave unprotected rows out of TCOS reimbursement.",
    assertions: {
      claim: cappedClaim,
      protected_fee_total:
        cappedProtectedA.feeAmount + cappedProtectedB.feeAmount,
      unprotected_fee: cappedUnprotected.feeAmount,
    },
  });
  const sellerVisibleProtection =
    buildUnder20SellerProtectionSellerVisibilitySummary(cappedRows);
  scenarios.push({
    scenario_key: "under_20_seller_protection_seller_order_visibility",
    scenario_status: pass(
      sellerVisibleProtection.status === "mixed" &&
        sellerVisibleProtection.reserveAmount === 0.54 &&
        sellerVisibleProtection.protectedRowCount === 2 &&
        sellerVisibleProtection.unprotectedRowCount === 1 &&
        sellerVisibleProtection.reimbursableItemAmount === 20 &&
        sellerVisibleProtection.shippingExcludedAmount === 1.36,
    ),
    detail:
      "Seller order views can show under-$20 protection status, 2% reserve, protected item cap, unprotected row liability, and shipping excluded from reimbursement.",
    assertions: {
      seller_visible_protection: sellerVisibleProtection,
    },
  });
  const allocationPlan = buildUnder20SellerProtectionReimbursementPlan({
    rows: [
      cappedRows[0],
      cappedRows[2],
      {
        id: "sim-ledger-protected-missing-seller",
        order_item_id: 2004,
        seller_account_id: null,
        gross_item_amount: 9.75,
        shipping_allocated_amount: 0.42,
        metadata: {
          under_20_seller_protection: getUnder20SellerProtection({
            method: "STANDARD_ENVELOPE",
            subtotal: 9.75,
            sellerOptedIn: true,
          }),
        },
      },
      cappedRows[1],
    ],
    reimbursableAmount: cappedClaim.reimbursableItemAmount,
  });
  scenarios.push({
    scenario_key: "under_20_seller_protection_reimbursement_allocation",
    scenario_status: pass(
      allocationPlan.requestedReimbursableAmount === 20 &&
        allocationPlan.reimbursedAmount === 20 &&
        allocationPlan.remainingAmount === 0 &&
        allocationPlan.allocations.length === 2 &&
        allocationPlan.allocations[0]?.amount === 14.25 &&
        allocationPlan.allocations[1]?.amount === 5.75 &&
        allocationPlan.allocations.every(
          (allocation) => allocation.sellerAccountId.length > 0,
        ) &&
        allocationPlan.skippedRowIds.includes("sim-ledger-unprotected-mixed") &&
        allocationPlan.skippedRowIds.includes(
          "sim-ledger-protected-missing-seller",
        ),
    ),
    detail:
      "Seller-protection Mark Paid allocation creates credits only for payable seller rows, stops at the $20 cap, skips unprotected/missing-seller rows, and keeps shipping excluded.",
    assertions: {
      allocation_plan: allocationPlan,
    },
  });
  const missingBuyerRefundGate = evaluateUnder20SellerProtectionBuyerRefundGate({
    note: "LetterTrack returned; no refund reference saved.",
  });
  const acceptedBuyerRefundGate = evaluateUnder20SellerProtectionBuyerRefundGate({
    note: "Buyer refund confirmed in Stripe refund ref re_123 after order review.",
  });
  const acceptedPriorBuyerRefundGate =
    evaluateUnder20SellerProtectionBuyerRefundMetadataGate({
      metadata: {
        latest_admin_status_change: {
          note: "Customer refund confirmed against order refund reference re_456 before payout.",
        },
      },
    });
  scenarios.push({
    scenario_key: "under_20_seller_protection_buyer_refund_gate",
    scenario_status: pass(
      missingBuyerRefundGate.allowed === false &&
        missingBuyerRefundGate.reason.includes("Before Mark Paid") &&
        acceptedBuyerRefundGate.allowed === true &&
        acceptedBuyerRefundGate.reason.includes("Buyer refund evidence") &&
        acceptedPriorBuyerRefundGate.allowed === true,
    ),
    detail:
      "Under-$20 seller-protection Mark Paid requires a current or previously saved internal note confirming buyer refund evidence or a refund reference before TCOS credits the seller.",
    assertions: {
      missing_buyer_refund_gate: missingBuyerRefundGate,
      accepted_buyer_refund_gate: acceptedBuyerRefundGate,
      accepted_prior_buyer_refund_gate: acceptedPriorBuyerRefundGate,
    },
  });

  const standardEnvelopeProfile =
    getShippingProviderAdapterProfile("STANDARD_ENVELOPE");
  const groundAdapterProfile =
    getShippingProviderAdapterProfile("GROUND_ADVANTAGE");
  scenarios.push({
    scenario_key: "shipping_adapter_profiles_are_auditable",
    scenario_status: pass(
      standardEnvelopeProfile.adapterKey === "standard_envelope_lettertrack_imb" &&
        groundAdapterProfile.adapterKey === "usps_parcel_label" &&
        standardEnvelopeProfile.livePurchaseSupported === false &&
        groundAdapterProfile.manualPurchaseRequired === true &&
        standardEnvelopeProfile.coverageProvider.length > 0,
    ),
    detail:
      "Shipping adapter profiles expose provider, carrier, credential, Coverage, live-support, and manual-fallback state without calling a live provider.",
    assertions: {
      standard_envelope: standardEnvelopeProfile,
      ground_advantage: groundAdapterProfile,
    },
  });

  const letterTrackExport = buildLetterTrackExport({
    exportedAt: "2026-07-12T12:00:00.000Z",
    labels: [
      {
        id: "sim-lettertrack-label-001",
        order_id: 1003,
        label_status: "planned",
        requested_shipping_method: "STANDARD_ENVELOPE",
        resolved_shipping_method: "STANDARD_ENVELOPE",
        coverage_amount: 18.75,
        coverage_status: "required_at_label_purchase",
        metadata: {
          standard_envelope_estimated_oz: 2,
        },
        created_at: "2026-07-12T11:00:00.000Z",
      },
    ],
    ordersById: new Map([
      [
        1003,
        {
          id: 1003,
          customer_email: "collector@example.com",
          customer_name: "Collector Example",
          shipping_name: "Collector Example",
          shipping_address_line1: "123 Cardboard Ct",
          shipping_address_line2: "",
          shipping_city: "Denver",
          shipping_state: "CO",
          shipping_postal_code: "80202",
          shipping_country: "US",
          subtotal: 18.75,
          total: 19.82,
          item_count: 2,
        },
      ],
    ]),
  });
  const letterTrackCsv = letterTrackCsvContent(letterTrackExport.rows);
  scenarios.push({
    scenario_key: "lettertrack_standard_envelope_export",
    scenario_status: pass(
      letterTrackExport.rows.length === 1 &&
        letterTrackExport.skipped.length === 0 &&
        letterTrackCsv.includes("LetterTrack / USPS Informed Visibility IMb") &&
        letterTrackCsv.includes("sellerProtectionReserveRate") &&
        letterTrackCsv.includes("TCOS-1003"),
    ),
    detail:
      "Standard Envelope labels can be exported to a LetterTrack import CSV with recipient address, order reference, value, and IMb recording instructions.",
    assertions: {
      row_count: letterTrackExport.rows.length,
      skipped_count: letterTrackExport.skipped.length,
      csv_preview: letterTrackCsv.split("\n").slice(0, 2),
    },
  });
  const letterTrackRow = letterTrackExport.rows[0];
  scenarios.push({
    scenario_key: "lettertrack_csv_seller_protection_contract",
    scenario_status: pass(
      letterTrackRow?.sellerProtectionProgram ===
        "TCOS Under-$20 Seller Protection" &&
        letterTrackRow?.sellerProtectionOptInRequired.includes("seller must opt in") &&
        letterTrackRow?.sellerProtectionReserveRate === "2%" &&
        letterTrackRow?.sellerProtectionMaxCoverage === "$20.00 item sale amount" &&
        letterTrackRow?.sellerProtectionCoverageBasis ===
          "item_sale_amount_excluding_shipping" &&
        letterTrackRow?.sellerProtectionReimbursesShipping === "no" &&
        letterTrackRow?.deliveryEvidenceRequirement.includes("LetterTrack status"),
    ),
    detail:
      "LetterTrack CSV rows carry the under-$20 seller-protection contract: opt-in required, 2% reserve, $20 item-only cap, shipping excluded, and IMb delivery-evidence requirement.",
    assertions: {
      seller_protection_program: letterTrackRow?.sellerProtectionProgram,
      opt_in_required: letterTrackRow?.sellerProtectionOptInRequired,
      reserve_rate: letterTrackRow?.sellerProtectionReserveRate,
      max_coverage: letterTrackRow?.sellerProtectionMaxCoverage,
      coverage_basis: letterTrackRow?.sellerProtectionCoverageBasis,
      reimburses_shipping: letterTrackRow?.sellerProtectionReimbursesShipping,
      delivery_evidence_requirement: letterTrackRow?.deliveryEvidenceRequirement,
    },
  });

  const deliveredEvidence = buildLetterTrackDeliveryEvidenceSummary([
    {
      provider: "LetterTrack / USPS IMb",
      carrier: "USPS IMb",
      tracking_number: "IMB123456789",
      event_type: "lettertrack_delivered",
      event_status: "delivered",
      message: "LetterTrack / USPS IMb evidence shows delivered.",
      occurred_at: "2026-07-12T18:00:00.000Z",
    },
  ]);
  const notDeliveredEvidence = buildLetterTrackDeliveryEvidenceSummary([
    {
      provider: "LetterTrack / USPS IMb",
      carrier: "USPS IMb",
      tracking_number: "IMB987654321",
      event_type: "lettertrack_not_delivered",
      event_status: "not_delivered",
      message: "LetterTrack / USPS IMb evidence does not show delivered.",
      occurred_at: "2026-07-12T18:00:00.000Z",
    },
  ]);
  scenarios.push({
    scenario_key: "lettertrack_delivery_evidence_claim_review_rules",
    scenario_status: pass(
      deliveredEvidence.deliveredEvidencePresent &&
        !deliveredEvidence.claimReviewSupported &&
        notDeliveredEvidence.claimReviewSupported &&
        !notDeliveredEvidence.deliveredEvidencePresent,
    ),
    detail:
      "LetterTrack IMb delivery evidence snapshots distinguish delivered shipments from not-delivered claim-review support before under-$20 seller-protection reimbursement.",
    assertions: {
      delivered: deliveredEvidence,
      not_delivered: notDeliveredEvidence,
    },
  });
  const deliveredPaymentGate = evaluateLetterTrackSellerProtectionPaymentGate({
    evidence: deliveredEvidence,
  });
  const notDeliveredPaymentGate =
    evaluateLetterTrackSellerProtectionPaymentGate({
      evidence: notDeliveredEvidence,
    });
  const overridePaymentGate = evaluateLetterTrackSellerProtectionPaymentGate({
    evidence: deliveredEvidence,
    overrideNote:
      "Override: buyer refund required after operator reviewed conflicting delivery evidence.",
  });
  const savedOverridePaymentGate =
    evaluateLetterTrackSellerProtectionPaymentMetadataGate({
      evidence: deliveredEvidence,
      metadata: {
        latest_admin_status_change: {
          note: "Override: buyer refund required after operator reviewed conflicting delivery evidence.",
        },
      },
    });
  scenarios.push({
    scenario_key: "lettertrack_seller_protection_paid_gate",
    scenario_status: pass(
      !deliveredPaymentGate.allowed &&
        notDeliveredPaymentGate.allowed &&
        overridePaymentGate.allowed &&
        overridePaymentGate.overrideAccepted &&
        savedOverridePaymentGate.allowed &&
        savedOverridePaymentGate.overrideAccepted,
    ),
    detail:
      "Under-$20 seller-protection payout blocks delivered LetterTrack evidence, allows not-delivered review evidence, and accepts a current or previously saved explicit override note for exceptions.",
    assertions: {
      delivered_gate: deliveredPaymentGate,
      not_delivered_gate: notDeliveredPaymentGate,
      override_gate: overridePaymentGate,
      saved_override_gate: savedOverridePaymentGate,
    },
  });
  const savedEvidenceReview = buildLetterTrackSellerProtectionEvidenceReview({
    status: "approved",
    reviewedAt: "2026-07-13T18:00:00.000Z",
    reviewedByIdentity: { type: "simulation" },
    note: "Ready for final payout review.",
    summary: notDeliveredEvidence,
    gate: notDeliveredPaymentGate,
  });
  scenarios.push({
    scenario_key: "lettertrack_seller_protection_evidence_review_audit",
    scenario_status: pass(
      ["submitted", "under_review", "approved", "paid", "denied"].every(
        (status) =>
          shouldRecordLetterTrackSellerProtectionEvidenceReview({
            status,
            eligible: true,
          }),
      ) &&
        !shouldRecordLetterTrackSellerProtectionEvidenceReview({
          status: "cancelled",
          eligible: true,
        }) &&
        !shouldRecordLetterTrackSellerProtectionEvidenceReview({
          status: "paid",
          eligible: false,
        }) &&
        savedEvidenceReview.status === "approved" &&
        savedEvidenceReview.summary.claimReviewSupported &&
        savedEvidenceReview.gate.allowed,
    ),
    detail:
      "Under-$20 seller-protection claim status changes save a LetterTrack evidence review audit record before payout.",
    assertions: {
      saved_evidence_review: savedEvidenceReview,
    },
  });

  const standardEnvelopePurchase = await purchaseShippingLabel({
    orderId: 1001,
    labelId: "sim-standard-envelope",
    method: "STANDARD_ENVELOPE",
    carrier: null,
    subtotal: 19.99,
    shippingAmount: standardEnvelopeRate,
    itemCount: 3,
    standardEnvelopeEstimatedOunces: 3,
  });
  scenarios.push({
    scenario_key: "dry_run_standard_envelope_purchase",
    scenario_status: pass(
      standardEnvelopePurchase.mode === "dry_run" &&
        standardEnvelopePurchase.trackingNumber.startsWith("IMB-") &&
        standardEnvelopePurchase.coverageStatus === "covered" &&
        standardEnvelopePurchase.postageAmount ===
          money(currentStandardEnvelopeRate),
    ),
    detail:
      "The dry-run adapter simulates a Standard Envelope IMb, coverage policy, and current-rate postage without buying postage.",
    assertions: {
      mode: standardEnvelopePurchase.mode,
      provider: standardEnvelopePurchase.provider,
      tracking_number: standardEnvelopePurchase.trackingNumber,
      postage_amount: standardEnvelopePurchase.postageAmount,
      expected_current_postage_amount: money(currentStandardEnvelopeRate),
      coverage_policy_id: standardEnvelopePurchase.coveragePolicyId,
    },
  });

  const groundPurchase = await purchaseShippingLabel({
    orderId: 1002,
    labelId: "sim-ground-advantage",
    method: "GROUND_ADVANTAGE",
    carrier: null,
    subtotal: 20.01,
    shippingAmount: 6.99,
    itemCount: 1,
  });
  scenarios.push({
    scenario_key: "dry_run_ground_advantage_purchase",
    scenario_status: pass(
      groundPurchase.mode === "dry_run" &&
        groundPurchase.trackingNumber.startsWith("USPS-") &&
        groundPurchase.coverageStatus === "covered" &&
        groundPurchase.postageAmount === 6.99,
    ),
    detail:
      "The dry-run adapter simulates a Ground Advantage tracking number, coverage policy, and postage without buying postage.",
    assertions: {
      mode: groundPurchase.mode,
      provider: groundPurchase.provider,
      tracking_number: groundPurchase.trackingNumber,
      postage_amount: groundPurchase.postageAmount,
      coverage_policy_id: groundPurchase.coveragePolicyId,
    },
  });

  const scenarioFailures = scenarios.filter(
    (scenario) => scenario.scenario_status === "failed",
  ).length;
  const scenarioCountMatches =
    scenarios.length === SHIPPING_SIMULATION_EXPECTED_SCENARIO_COUNT;
  const scenarioKeys = scenarios.map((scenario) => scenario.scenario_key);
  const missingScenarioKeys = SHIPPING_SIMULATION_EXPECTED_SCENARIO_KEYS.filter(
    (scenarioKey) => !scenarioKeys.includes(scenarioKey),
  );
  const unexpectedScenarioKeys = scenarioKeys.filter(
    (scenarioKey) =>
      !SHIPPING_SIMULATION_EXPECTED_SCENARIO_KEYS.includes(
        scenarioKey as (typeof SHIPPING_SIMULATION_EXPECTED_SCENARIO_KEYS)[number],
      ),
  );
  const scenarioKeysMatch =
    missingScenarioKeys.length === 0 && unexpectedScenarioKeys.length === 0;
  const failed =
    scenarioFailures +
    (scenarioCountMatches ? 0 : 1) +
    (scenarioKeysMatch ? 0 : 1);
  const runStatus = failed > 0 ? "failed" : "passed";
  const requirementBlockers = providerSetup.liveRequirements
    .filter((requirement) => requirement.status !== "ready")
    .map((requirement) => requirement.label);
  const blockers = Array.from(
    new Set([
      ...requirementBlockers,
      ...providerSetup.decision.blockers,
      ...(!scenarioCountMatches
        ? [
            `shipping simulation scenario count changed: expected ${SHIPPING_SIMULATION_EXPECTED_SCENARIO_COUNT}, found ${scenarios.length}`,
          ]
        : []),
      ...(!scenarioKeysMatch
        ? [
            `shipping simulation scenario keys changed: missing ${
              missingScenarioKeys.join(", ") || "none"
            }; unexpected ${unexpectedScenarioKeys.join(", ") || "none"}`,
          ]
        : []),
      ...(runStatus === "failed" ? ["shipping simulation suite failed"] : []),
    ]),
  );
  const readyToRequestLiveMode =
    runStatus === "passed" &&
    blockers.length === 0 &&
    !["needs_provider_setup", "live_blocked"].includes(
      providerSetup.decision.status,
    );
  const liveApproval: LiveShippingApprovalReport = {
    approval_status: readyToRequestLiveMode
      ? "ready_to_request_live_mode"
      : "blocked",
    detail: readyToRequestLiveMode
      ? "Shipping simulations passed and all live-shipping approval gates are ready. A controlled live-mode request can be reviewed."
      : "Live shipping remains blocked. TCOS may plan labels, run dry-run purchase simulations, and record real external labels manually, but it must not buy live postage.",
    next_action: readyToRequestLiveMode
      ? "Review the provider setup packet, save approval evidence, and only then consider TCOS_SHIPPING_PURCHASE_MODE=live."
      : "Clear the listed blockers in the Live Adapter Approval Checklist, rerun simulations, and keep TCOS_SHIPPING_PURCHASE_MODE=dry_run.",
    provider_setup_status: providerSetup.decision.status,
    purchase_mode: providerSetup.lanes[0]?.purchaseMode || "dry_run",
    simulation_status: runStatus,
    requirements_ready_count: providerSetup.liveRequirements.filter(
      (requirement) => requirement.status === "ready",
    ).length,
    requirements_count: providerSetup.liveRequirements.length,
    blockers,
  };

  return {
    suite_version: SHIPPING_SIMULATION_SUITE_VERSION,
    run_status: runStatus,
    expected_scenario_count: SHIPPING_SIMULATION_EXPECTED_SCENARIO_COUNT,
    scenario_coverage_status: scenarioCountMatches ? "passed" : "failed",
    expected_scenario_keys: SHIPPING_SIMULATION_EXPECTED_SCENARIO_KEYS,
    missing_scenario_keys: missingScenarioKeys,
    unexpected_scenario_keys: unexpectedScenarioKeys,
    scenario_key_coverage_status: scenarioKeysMatch ? "passed" : "failed",
    scenario_count: scenarios.length,
    passed_count: scenarios.length - scenarioFailures,
    failed_count: failed,
    live_approval: liveApproval,
    scenarios,
  };
}
