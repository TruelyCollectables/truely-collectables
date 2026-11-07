export type RegistryProbeIdentity = Record<string, any>;

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedCardNumber(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function explicitParallel(value: unknown) {
  const clean = normalized(value);
  return clean && clean !== "base" && clean !== "base set" ? clean : "";
}

export function buildEvidenceFirstRegistryProbe(params: {
  evidenceAi: RegistryProbeIdentity;
  listingIdentityHint?: RegistryProbeIdentity | null;
  registryVisibleText?: string | null;
  parallelEvidenceAdjudicated?: boolean;
}) {
  const hint = params.listingIdentityHint || {};
  const probe: RegistryProbeIdentity = {
    ...params.evidenceAi,
    registryVisibleText: text(params.registryVisibleText),
    parallelEvidenceAdjudicated: params.parallelEvidenceAdjudicated === true,
  };

  // Marketplace/listing text is a lookup hint only. It may fill a field the
  // scanners could not read, but it can never overwrite a non-blank physical
  // image/council field. This prevents stale seller titles from steering the
  // Registry away from hard facts printed on the card.
  for (const key of ["year", "brand", "setName", "cardNumber"] as const) {
    if (!text(probe[key]) && text(hint[key])) probe[key] = hint[key];
  }

  return probe;
}

export function registryMatchEvidenceConflicts(params: {
  registryMatch: RegistryProbeIdentity | null | undefined;
  evidenceAi: RegistryProbeIdentity;
  parallelEvidenceAdjudicated?: boolean;
}) {
  const match = params.registryMatch || {};
  const evidence = params.evidenceAi || {};
  const reasons: string[] = [];

  const evidenceCard = normalizedCardNumber(evidence.cardNumber ?? evidence.card_number);
  const registryCard = normalizedCardNumber(match.cardNumber ?? match.card_number);
  if (evidenceCard && registryCard && evidenceCard !== registryCard) {
    reasons.push("registry_card_number_conflicts_with_physical_evidence");
  }

  const evidencePlayer = normalized(evidence.player ?? evidence.playerName);
  const registryPlayer = normalized(match.player ?? match.playerName);
  if (evidencePlayer && registryPlayer && evidencePlayer !== registryPlayer) {
    reasons.push("registry_player_conflicts_with_physical_evidence");
  }

  const evidenceYear = normalized(evidence.year);
  const registryYear = normalized(match.year);
  if (evidenceYear && registryYear && evidenceYear !== registryYear) {
    reasons.push("registry_year_conflicts_with_physical_evidence");
  }

  if (params.parallelEvidenceAdjudicated === true) {
    const evidenceParallel = explicitParallel(
      evidence.parallel ?? evidence.parallelName ?? evidence.checklistParallel,
    );
    const registryParallel = explicitParallel(match.parallel ?? match.parallelName);
    if (evidenceParallel && evidenceParallel !== registryParallel) {
      reasons.push("registry_parallel_conflicts_with_adjudicated_physical_evidence");
    }
  }

  if (typeof evidence.isAuto === "boolean" && typeof match.isAuto === "boolean") {
    if (evidence.isAuto !== match.isAuto) {
      reasons.push("registry_autograph_state_conflicts_with_physical_evidence");
    }
  }
  if (typeof evidence.isRelic === "boolean" && typeof match.isRelic === "boolean") {
    if (evidence.isRelic !== match.isRelic) {
      reasons.push("registry_relic_state_conflicts_with_physical_evidence");
    }
  }

  return reasons;
}
