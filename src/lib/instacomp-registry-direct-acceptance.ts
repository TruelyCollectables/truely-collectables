import type { ChecklistRegistryLookupResult } from "./instacomp-learning-server";

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

function specificParallelEvidence(value: unknown) {
  const normalized = normalizedText(value);
  if (!normalized) return false;
  return !["base", "base card", "standard", "regular"].includes(normalized);
}

function serialRunEvidence(value: unknown) {
  return /\/(\d{1,7})\s*$/.test(String(value ?? "").trim());
}

export function shouldAcceptDirectRegistryRecovery(params: {
  probe: Record<string, any>;
  resolution: ChecklistRegistryLookupResult | null;
}) {
  const match =
    params.resolution?.status === "internal_exact_match"
      ? params.resolution.match
      : null;
  if (!match?.identityId || !match.fingerprintSha256) return false;

  const observedNumber = normalizedCardNumber(params.probe.cardNumber);
  const canonicalNumber = normalizedCardNumber(match.cardNumber);
  if (!observedNumber || !canonicalNumber) return false;

  const physicalAliasUsed = observedNumber !== canonicalNumber;
  if (!physicalAliasUsed) return true;

  // A physical printed-number alias can point at a canonical checklist card
  // that has many parallels. Never let the absence of variant evidence silently
  // collapse that family to Base. Alias recovery is accepted only when the scan
  // carries a specific parallel or serial-run witness and the direct resolver
  // has already reduced those facts to one unique current Registry fingerprint.
  return (
    specificParallelEvidence(params.probe.parallel) ||
    serialRunEvidence(params.probe.serialNumber)
  );
}
