function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function identitySummary(value: unknown) {
  const identity = recordValue(value);
  const risk = stringValue(identity.risk);
  const blocked = booleanValue(identity.blocked);
  const blockReason = stringValue(identity.blockReason);

  return [risk ? `risk=${risk}` : null, blocked ? "blocked" : null, blockReason]
    .filter(Boolean)
    .join(" / ");
}

export function buildShippingPurchaseAttemptAudit(value: unknown) {
  const source = recordValue(value);
  const liveShippingGate = recordValue(source.live_shipping_gate);
  const shippingAdapterProfile = recordValue(source.shipping_adapter_profile);
  const providerReadiness = recordValue(source.provider_readiness);
  const purchaseResult = recordValue(source.purchase_result);
  const ready = booleanValue(source.standard_envelope_evidence_contract_ready);
  const provider = stringValue(source.standard_envelope_evidence_provider);
  const blockers = [
    ...stringList(source.blockers),
    ...stringList(source.missingCredentialKeys),
    ...stringList(shippingAdapterProfile.missingCredentialKeys),
    ...stringList(shippingAdapterProfile.missingCoverageCredentialKeys),
  ];
  const liveGateReason = stringValue(liveShippingGate.reason);
  const providerReadinessMissing = [
    ...stringList(providerReadiness.missingCredentialKeys),
    ...stringList(providerReadiness.missingCoverageCredentialKeys),
  ];
  const identity = identitySummary(source.attempted_by_identity);
  const evidenceSummary =
    ready === null
      ? null
      : `Standard Envelope evidence validator: ${ready ? "ready" : "blocked"}${
          provider ? ` (${provider})` : ""
        }.`;
  const details = [
    stringValue(source.status) ? `Status: ${stringValue(source.status)}.` : null,
    stringValue(source.blocker_type)
      ? `Blocker type: ${stringValue(source.blocker_type)}.`
      : null,
    liveGateReason ? `Live gate: ${liveGateReason}` : null,
    blockers.length > 0 ? `Missing/blocking setup: ${blockers.join(", ")}.` : null,
    providerReadinessMissing.length > 0
      ? `Provider readiness missing: ${providerReadinessMissing.join(", ")}.`
      : null,
    stringValue(shippingAdapterProfile.provider)
      ? `Provider profile: ${stringValue(shippingAdapterProfile.provider)}${
          stringValue(shippingAdapterProfile.carrier)
            ? ` / ${stringValue(shippingAdapterProfile.carrier)}`
            : ""
        }${
          stringValue(shippingAdapterProfile.purchaseMode)
            ? ` / ${stringValue(shippingAdapterProfile.purchaseMode)}`
            : ""
        }.`
      : null,
    stringValue(purchaseResult.mode)
      ? `Purchase mode: ${stringValue(purchaseResult.mode)}.`
      : null,
    stringValue(source.attempted_at)
      ? `Attempted at: ${stringValue(source.attempted_at)}.`
      : null,
    identity ? `Attempt identity: ${identity}.` : null,
  ].filter((detail): detail is string => Boolean(detail));

  return {
    present: Object.keys(source).length > 0,
    standardEnvelopeEvidenceContractReady: ready,
    standardEnvelopeEvidenceProvider: provider,
    evidenceSummary,
    details,
    sentence: [evidenceSummary, ...details].filter(Boolean).join(" "),
  };
}

export function shippingPurchaseAttemptAuditSentence(value: unknown) {
  const audit = buildShippingPurchaseAttemptAudit(value);
  return audit.sentence ? ` ${audit.sentence}` : "";
}

export function shippingPurchaseAttemptAuditLines(value: unknown) {
  const audit = buildShippingPurchaseAttemptAudit(value);
  if (!audit.present) return ["No latest provider purchase attempt is saved."];

  return [audit.evidenceSummary || "Standard Envelope evidence validator: Not saved.", ...audit.details];
}
