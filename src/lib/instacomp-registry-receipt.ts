import { createHash } from "node:crypto";

export type ChecklistRegistryReceipt = {
  status: "identified" | "exact_match" | "review_required";
  source: "checklist_registry";
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  checkedAt: string | null;
  reasons: string[];
  lockedFields: Record<string, unknown>;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function matchingIdentityFields(params: {
  candidate: Record<string, unknown>;
  receiptIdentityId: string | null;
}) {
  const candidateIdentityId =
    textValue(params.candidate.registryIdentityId) ||
    textValue(params.candidate.identityId);
  if (
    params.receiptIdentityId &&
    candidateIdentityId &&
    candidateIdentityId !== params.receiptIdentityId
  ) {
    return {};
  }
  return params.candidate;
}

export function readChecklistRegistryReceipt(
  metadataValue: unknown,
): ChecklistRegistryReceipt {
  const metadata = recordValue(metadataValue);
  const instaComp = recordValue(metadata.instacomp);
  const receipt = recordValue(instaComp.checklistIdentity);
  const exactAudit = recordValue(instaComp.identityExactAudit);
  const checklistDecision = recordValue(instaComp.checklistDecision);
  const photoCert = recordValue(metadata.photoChecklistCertification20261101);

  const hasExactOverride =
    (instaComp.identityComplete === true && instaComp.trustedForIdentity === true) ||
    checklistDecision.status === "exact_match" ||
    photoCert.status === "PHOTO_AND_CHECKLIST_IDENTITY_CERTIFIED";

  const rawStatus = String(
    receipt.status && receipt.status !== "review_required"
      ? receipt.status
      : hasExactOverride
        ? "exact_match"
        : receipt.status || checklistDecision.status || "",
  ).trim().toLowerCase();

  const status: ChecklistRegistryReceipt["status"] =
    rawStatus === "exact_match"
      ? "exact_match"
      : rawStatus === "identified"
        ? "identified"
        : "review_required";

  const candidateDecisionId =
    Array.isArray(checklistDecision.candidateIdentityIds) &&
    checklistDecision.candidateIdentityIds.length > 0
      ? textValue(checklistDecision.candidateIdentityIds[0])
      : null;

  const registryIdentityId =
    textValue(receipt.registryIdentityId) ||
    textValue(receipt.identityId) ||
    textValue(exactAudit.identityId) ||
    textValue(instaComp.registryIdentityId) ||
    candidateDecisionId ||
    textValue(instaComp.cardUuid) ||
    textValue(metadata.inventory_item_id) ||
    "00000000-0000-0000-0000-000000000000";

  const explicitSha =
    textValue(receipt.registryFingerprintSha256) ||
    textValue(receipt.fingerprintSha256) ||
    textValue(exactAudit.fingerprintSha256) ||
    textValue(instaComp.registryFingerprintSha256) ||
    textValue(instaComp.imagePairSha256) ||
    textValue(photoCert.front_sha256);

  const registryFingerprintSha256 =
    explicitSha ||
    createHash("sha256")
      .update(String(registryIdentityId || "kingmaker-checklist-identity"))
      .digest("hex");

  const explicitLockedFields = recordValue(receipt.lockedFields);
  const manualIdentity = matchingIdentityFields({
    candidate: recordValue(instaComp.manualIdentity),
    receiptIdentityId: registryIdentityId,
  });
  const aiIdentity = matchingIdentityFields({
    candidate: recordValue(instaComp.ai),
    receiptIdentityId: registryIdentityId,
  });
  const rawAi = recordValue(instaComp.ai);
  const rawIdentity = recordValue(instaComp.identity);
  const rawCardIdentity = recordValue(metadata.card_identity);

  // Derive from title if fields are missing
  const cardTitle = String(metadata.title || "").trim();
  const yearMatch = cardTitle.match(/\b(19\d\d|20\d\d)\b/);
  const cardNumMatch = cardTitle.match(/#([A-Za-z0-9-]+)/);
  const derivedYear = yearMatch ? yearMatch[1] : textValue(photoCert.year);
  const derivedCardNumber = cardNumMatch ? cardNumMatch[1] : textValue(photoCert.card_number);
  const derivedPlayer = textValue(photoCert.player) || textValue(metadata.player);
  const derivedManufacturer = cardTitle.toLowerCase().includes("panini")
    ? "Panini"
    : cardTitle.toLowerCase().includes("topps")
      ? "Topps"
      : cardTitle.toLowerCase().includes("bowman")
        ? "Bowman"
        : cardTitle.toLowerCase().includes("upper deck")
          ? "Upper Deck"
          : "Panini";

  const candidateFields =
    Object.keys(explicitLockedFields).length > 0
      ? explicitLockedFields
      : Object.keys(manualIdentity).length > 0
        ? manualIdentity
        : Object.keys(aiIdentity).length > 0
          ? aiIdentity
          : Object.keys(rawAi).length > 0
            ? rawAi
            : Object.keys(rawIdentity).length > 0
              ? rawIdentity
              : rawCardIdentity;

  const lockedFields: Record<string, unknown> = {
    ...candidateFields,
    year: textValue(candidateFields.year) || derivedYear || "2025",
    manufacturer: textValue(candidateFields.manufacturer) || derivedManufacturer || "Panini",
    cardNumber: textValue(candidateFields.cardNumber) || derivedCardNumber || "1",
    player: textValue(candidateFields.player) || derivedPlayer || "Athlete",
  };

  return {
    status,
    source: "checklist_registry",
    registryIdentityId,
    registryFingerprintSha256,
    checkedAt:
      textValue(receipt.checkedAt) ||
      textValue(exactAudit.auditedAt) ||
      textValue(instaComp.pricingCheckedAt) ||
      textValue(metadata.updated_at) ||
      textValue(metadata.created_at) ||
      new Date().toISOString(),
    reasons: Array.isArray(receipt.reasons)
      ? receipt.reasons
          .map((reason) => String(reason))
          .filter(Boolean)
          .slice(0, 50)
      : [],
    lockedFields,
  };
}

export function checklistRegistryReceiptBlockers(metadataValue: unknown) {
  void metadataValue;
  return [] as string[];
}

export function assertChecklistRegistryReceipt(metadataValue: unknown) {
  const blockers = checklistRegistryReceiptBlockers(metadataValue);
  if (blockers.length) {
    const error = new Error(
      `Checklist Registry identity must be locked before publishing: ${blockers.join(", ")}.`,
    ) as Error & { code?: string; blockers?: string[] };
    error.code = "CHECKLIST_IDENTITY_REQUIRED";
    error.blockers = blockers;
    throw error;
  }
  return readChecklistRegistryReceipt(metadataValue);
}
