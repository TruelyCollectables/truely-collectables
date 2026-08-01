type UnknownRecord = Record<string, unknown>;

export type PendingImportIdentityCorrection = {
  clientId: string;
  title: string;
  description: string;
  identity: UnknownRecord;
  reason: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalParallel(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/\bcracked\s+ice\b/g, "ice")
    .replace(/\bprizms?\b/g, " ")
    .replace(/\bparallel\b/g, " ")
    .replace(/\bvariation\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const KIKI_IRIAFEN_149_CRACKED_ICE: PendingImportIdentityCorrection = {
  clientId: "SCAN-0195",
  title:
    "2025 Panini Prizm WNBA #149 Kiki Iriafen Variation Cracked Ice Prizm RC",
  description: [
    "2025 Panini Prizm WNBA #149 Kiki Iriafen Variation Cracked Ice Prizm RC",
    "",
    "Player/Subject: Kiki Iriafen",
    "Team: Washington Mystics",
    "Sport: Basketball",
    "Year: 2025",
    "Brand: Panini",
    "Set: Prizm WNBA",
    "Card Number: 149",
    "Subset/Variation: Rookie Variation",
    "Parallel/Variation: Cracked Ice Prizm (Panini checklist name: Ice)",
    "Rookie: Yes",
    "Images: Front and back",
    "",
    "The listing images show the exact card you will receive.",
  ].join("\n"),
  identity: {
    player: "Kiki Iriafen",
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini",
    setName: "Prizm WNBA",
    subset: "Rookie Variation",
    variation: "Rookie Variation",
    cardNumber: "149",
    parallel: "Cracked Ice Prizm",
    checklistParallel: "Ice",
    serialNumber: null,
    printRun: null,
    team: "Washington Mystics",
    sport: "Basketball",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    identificationConfidence: "High",
    notes:
      "Corrected from the stored front/back scan and 2025 Panini Prizm WNBA checklist. Mosaic is /3 and was invalid without a visible serial stamp; this card is the unnumbered Ice/Cracked Ice rookie variation.",
  },
  reason:
    "The scanner overwrote an imported Ice/Cracked Ice identity with Mosaic even though Mosaic is serialized /3 and no serial stamp is visible.",
};

const CORRECTIONS: Record<string, PendingImportIdentityCorrection> = {
  [KIKI_IRIAFEN_149_CRACKED_ICE.clientId]: KIKI_IRIAFEN_149_CRACKED_ICE,
};

export function pendingImportIdentityCorrection(
  metadata: UnknownRecord,
): PendingImportIdentityCorrection | null {
  const pendingImport = record(metadata.pendingImport);
  const clientId = text(pendingImport.clientId);
  return CORRECTIONS[clientId] || null;
}

export function shouldApplyPendingImportIdentityCorrection(
  metadata: UnknownRecord,
  currentTitle: unknown,
) {
  const correction = pendingImportIdentityCorrection(metadata);
  if (!correction) return false;
  const identity = record(metadata.cardIdentity);
  const currentParallel = canonicalParallel(identity.parallel);
  const title = text(currentTitle).toLowerCase();
  return currentParallel === "mosaic" || title.includes("mosaic prizm");
}
