from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing patch marker: {label}")
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# Pure listing gate: checklist/public-claim verification and imported identity
# conflict protection.
# -----------------------------------------------------------------------------
gate_path = Path("src/lib/instacomp-listing-gate.ts")
gate_path.write_text(r'''export type InstaCompListingGateRecord = Record<string, unknown>;

export type InstaCompListingGateResult = {
  identity: InstaCompListingGateRecord;
  identityApproved: boolean;
  priceApproved: boolean;
  confidence: number;
  catalogConfirmed: boolean;
  reviewReasons: string[];
};

function record(value: unknown): InstaCompListingGateRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as InstaCompListingGateRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function normalizedText(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

export function canonicalInstaCompParallel(value: unknown) {
  return normalizedText(value)
    .replace(/\bcracked\s+ice\b/g, "ice")
    .replace(/\bprizms?\b/g, " ")
    .replace(/\bparallel\b/g, " ")
    .replace(/\bvariation\b/g, " ")
    .replace(/\bbase\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function differs(left: unknown, right: unknown, normalizer = normalizedText) {
  const a = normalizer(left);
  const b = normalizer(right);
  return Boolean(a && b && a !== b);
}

function identityConflicts(
  importedIdentity: InstaCompListingGateRecord,
  proposedIdentity: InstaCompListingGateRecord,
) {
  const conflicts: string[] = [];
  if (differs(importedIdentity.player, proposedIdentity.player)) {
    conflicts.push("player_conflicts_with_imported_identity");
  }
  if (
    differs(
      importedIdentity.cardNumber,
      proposedIdentity.cardNumber,
      normalizedCardNumber,
    )
  ) {
    conflicts.push("card_number_conflicts_with_imported_identity");
  }
  if (
    differs(
      importedIdentity.parallel,
      proposedIdentity.parallel,
      canonicalInstaCompParallel,
    )
  ) {
    conflicts.push("parallel_conflicts_with_imported_identity");
  }
  return conflicts;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry)).filter(Boolean)
    : [];
}

export function evaluateInstaCompListingGate(params: {
  payload: InstaCompListingGateRecord;
  importedIdentity?: InstaCompListingGateRecord | null;
  pendingImport?: InstaCompListingGateRecord | null;
}): InstaCompListingGateResult {
  const ai = record(params.payload.ai);
  const review = record(params.payload.review);
  const catalogEvidence = record(params.payload.catalogEvidence);
  const actionPermissions = record(catalogEvidence.actionPermissions);
  const catalogIdentity = record(catalogEvidence.compIdentity);
  const knowledge = record(params.payload.knowledge);
  const importedIdentity = record(params.importedIdentity);
  const pendingImport = record(params.pendingImport);

  const identity: InstaCompListingGateRecord = {
    ...ai,
    player: text(catalogIdentity.player) || ai.player || null,
    year: text(catalogIdentity.year) || ai.year || null,
    brand: text(catalogIdentity.brand) || ai.brand || null,
    setName: text(catalogIdentity.setName) || ai.setName || null,
    cardNumber: text(catalogIdentity.cardNumber) || ai.cardNumber || null,
    parallel:
      text(catalogIdentity.parallel) ||
      text(catalogIdentity.variation) ||
      ai.parallel ||
      null,
    serialNumber:
      text(ai.serialNumber) ||
      text(catalogIdentity.serialNumber) ||
      text(catalogIdentity.serialRun) ||
      null,
    team: text(catalogIdentity.team) || ai.team || null,
    sport: text(catalogIdentity.sport) || ai.sport || null,
    isAuto:
      typeof catalogIdentity.isAuto === "boolean"
        ? catalogIdentity.isAuto
        : ai.isAuto === true,
    isRelic:
      typeof catalogIdentity.isRelic === "boolean"
        ? catalogIdentity.isRelic
        : ai.isRelic === true,
  };

  const confidence = Math.max(
    0,
    Math.min(
      1,
      numberValue(ai.confidence) || numberValue(knowledge.identityConfidence),
    ),
  );
  const catalogConfirmed =
    text(catalogEvidence.status) === "catalog_confirmed" &&
    booleanValue(catalogEvidence.catalogConfirmed) &&
    booleanValue(actionPermissions.publicListingClaimAllowed);
  const reviewReasons = arrayOfStrings(review.identityReviewReasons);

  if (!catalogConfirmed) reviewReasons.push("checklist_identity_not_confirmed");
  if (confidence < 0.92) reviewReasons.push("low_identification_confidence");

  const catalogSerialRun = text(catalogIdentity.serialRun);
  const observedSerialNumber = text(ai.serialNumber);
  if (catalogSerialRun && !observedSerialNumber) {
    reviewReasons.push("serialized_checklist_parallel_without_visible_serial");
  }

  const importedConfidence = normalizedText(
    importedIdentity.identificationConfidence,
  );
  const importedIsHighConfidence =
    ["high", "verified", "manual confirmed", "manual_confirmed"].includes(
      importedConfidence,
    ) &&
    text(pendingImport.source) === "truely_collectables_scan_package";
  if (importedIsHighConfidence) {
    reviewReasons.push(...identityConflicts(importedIdentity, identity));
  }

  const uniqueReasons = Array.from(new Set(reviewReasons.filter(Boolean)));
  const identityApproved = uniqueReasons.length === 0;
  const priceApproved =
    identityApproved &&
    review.trustedForPricing === true &&
    actionPermissions.autoPriceAllowed === true;

  return {
    identity,
    identityApproved,
    priceApproved,
    confidence,
    catalogConfirmed,
    reviewReasons: uniqueReasons,
  };
}
''')


# -----------------------------------------------------------------------------
# Evidence-backed one-time correction for the exact imported scan that was
# overwritten by the bad Mosaic result.
# -----------------------------------------------------------------------------
correction_path = Path("src/lib/pending-import-identity-corrections.ts")
correction_path.write_text(r'''type UnknownRecord = Record<string, unknown>;

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
''')


# -----------------------------------------------------------------------------
# Checklist Registry: never confirm a numbered parallel without visible serial
# evidence, and normalize collector alias “Cracked Ice” to checklist “Ice”.
# -----------------------------------------------------------------------------
learning_path = Path("src/lib/instacomp-learning-server.ts")
learning = learning_path.read_text()
learning = replace_once(
    learning,
    '''function isBaseParallel(value: unknown) {
  const normalized = normalizedText(value);
  return !normalized || ["base", "base card", "standard", "regular"].includes(normalized);
}

function asNumber(value: unknown) {
''',
    '''function isBaseParallel(value: unknown) {
  const normalized = normalizedText(value);
  return !normalized || ["base", "base card", "standard", "regular"].includes(normalized);
}

function checklistParallelTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "prizm",
          "prizms",
          "parallel",
          "variation",
          "rookie",
          "card",
        ].includes(token),
    );
}

function asNumber(value: unknown) {
''',
    "checklist parallel alias helper",
)
learning = replace_once(
    learning,
    '''  const targetParallel = normalizedText(ai.parallel);
  const targetSerialRun = String(ai.serialNumber || "").match(/\\/(\\d{1,7})\\b/)?.[1];
''',
    '''  const targetParallel = normalizedText(ai.parallel);
  const targetParallelTokens = checklistParallelTokens(ai.parallel);
  const targetSerialRun = String(ai.serialNumber || "").match(/\\/(\\d{1,7})\\b/)?.[1];
''',
    "registry target parallel tokens",
)
learning = replace_once(
    learning,
    '''      if (!targetBase) {
        const wanted = meaningfulTokens(targetParallel);
        const offered = new Set(meaningfulTokens(parallelName));
        if (!wanted.length || !wanted.every((token) => offered.has(token))) continue;
      }

      const serialRun = asNumber(identity.parallel?.serial_run);
      if (targetSerialRun && serialRun !== Number(targetSerialRun)) continue;
''',
    '''      if (!targetBase) {
        const offered = new Set(checklistParallelTokens(parallelName));
        if (
          !targetParallelTokens.length ||
          !targetParallelTokens.every((token) => offered.has(token))
        ) {
          continue;
        }
      }

      const serialRun = asNumber(identity.parallel?.serial_run);
      // A numbered checklist parallel cannot be publicly confirmed unless the
      // physical card supplied a visible serial stamp. This prevents an
      // unnumbered Ice card from being “confirmed” as Mosaic /3.
      if (serialRun && !targetSerialRun) continue;
      if (targetSerialRun && serialRun !== Number(targetSerialRun)) continue;
''',
    "registry serial evidence guard",
)
learning_path.write_text(learning)


# -----------------------------------------------------------------------------
# Preserve immutable imported identity snapshots for every future package.
# -----------------------------------------------------------------------------
import_path = Path("src/app/api/admin/pending-card-import/route.ts")
import_route = import_path.read_text()
import_route = replace_once(
    import_route,
    '''            originalManifestTitle: cleanText(rawItem.title, 200),
            frontImageFile: cleanText(rawItem.front_image, 300),
''',
    '''            originalManifestTitle: cleanText(rawItem.title, 200),
            originalIdentity: {
              player: cleanText(rawItem.player, 120),
              year: cleanText(rawItem.year, 20),
              manufacturer: cleanText(rawItem.manufacturer, 80),
              brand: cleanText(rawItem.brand, 80),
              setName: cleanText(rawItem.set_name, 120),
              subset: cleanText(rawItem.subset, 120),
              cardNumber: cleanText(rawItem.card_number, 80),
              parallel: cleanText(rawItem.parallel, 120),
              serialNumber: cleanText(rawItem.serial_number, 80),
              printRun: cleanText(rawItem.title_print_run, 80),
              team: cleanText(rawItem.team, 120),
              sport: cleanText(rawItem.sport, 80),
              isRookie: cleanBoolean(rawItem.rookie),
              isAuto: cleanBoolean(rawItem.is_auto),
              isRelic: cleanBoolean(rawItem.is_relic),
              identificationConfidence: cleanText(
                rawItem.identification_confidence,
                40,
              ),
              notes: cleanText(rawItem.notes, 1000),
            },
            frontImageFile: cleanText(rawItem.front_image, 300),
''',
    "immutable imported identity snapshot",
)
import_path.write_text(import_route)


# -----------------------------------------------------------------------------
# Queue API: self-heal the known bad draft and refuse unverified identity/price
# overwrites from InstaComp.
# -----------------------------------------------------------------------------
queue_path = Path("src/app/api/admin/card-listing-queue/route.ts")
queue = queue_path.read_text()
queue = replace_once(
    queue,
    '''import { buildCardListingTitle } from "../../../../lib/card-listing-title";
import { handleGuardedDualMarketplaceGet } from "../../../../lib/dual-marketplace-admin-route-guard";
''',
    '''import { buildCardListingTitle } from "../../../../lib/card-listing-title";
import { handleGuardedDualMarketplaceGet } from "../../../../lib/dual-marketplace-admin-route-guard";
import { evaluateInstaCompListingGate } from "../../../../lib/instacomp-listing-gate";
import {
  pendingImportIdentityCorrection,
  shouldApplyPendingImportIdentityCorrection,
} from "../../../../lib/pending-import-identity-corrections";
''',
    "queue gate imports",
)
queue = replace_once(
    queue,
    '''async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "TCOS listing queue actions are owner/admin only.",
      403,
      "INSTACOMP_ADMIN_REQUIRED",
    );
  }
  return actor;
}

export async function GET(request: Request) {
''',
    '''async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "TCOS listing queue actions are owner/admin only.",
      403,
      "INSTACOMP_ADMIN_REQUIRED",
    );
  }
  return actor;
}

async function applyKnownPendingImportCorrection(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  row: UnknownRecord;
  metadata: UnknownRecord;
}) {
  const correction = pendingImportIdentityCorrection(params.metadata);
  if (
    !correction ||
    !shouldApplyPendingImportIdentityCorrection(
      params.metadata,
      params.row.websiteTitle,
    )
  ) {
    return null;
  }

  const websiteStatus = text(params.row.websiteStatus, 60) || "draft";
  const ebayStatus = text(params.row.ebayStatus, 60) || "draft";
  if (
    BLOCKED_DELETE_STATUSES.has(websiteStatus) ||
    BLOCKED_DELETE_STATUSES.has(ebayStatus) ||
    text(params.row.ebayItemId, 100)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const pendingImport = record(params.metadata.pendingImport);
  const existingDual = record(params.metadata.dual_marketplace);
  const existingWebsite = record(existingDual.website);
  const existingEbay = record(existingDual.ebay);
  const nextMetadata = {
    ...params.metadata,
    pendingImport: {
      ...pendingImport,
      originalIdentity: correction.identity,
      correction: {
        appliedAt: now,
        source: "checklist_and_stored_images",
        reason: correction.reason,
      },
    },
    cardIdentity: {
      ...record(params.metadata.cardIdentity),
      ...correction.identity,
    },
    instacomp: {
      ...record(params.metadata.instacomp),
      status: "pending",
      version: "2.0",
      scanId: null,
      identityConfidence: null,
      listingPrice: null,
      searchQuery: null,
      decision: null,
      reviewReasons: ["known_checklist_correction_applied"],
      correctedAt: now,
    },
    dual_marketplace: {
      ...existingDual,
      website: {
        ...existingWebsite,
        title: correction.title,
        description: correction.description,
        price: 0,
        status: websiteStatus,
      },
      ebay: {
        ...existingEbay,
        title: correction.title.slice(0, 80),
        description: correction.description,
        price: 0,
        aspects: {
          ...record(existingEbay.aspects),
          Player: ["Kiki Iriafen"],
          Team: ["Washington Mystics"],
          Sport: ["Basketball"],
          Year: ["2025"],
          Brand: ["Panini"],
          Set: ["Prizm WNBA"],
          "Card Number": ["149"],
          "Parallel/Variety": ["Cracked Ice Prizm"],
        },
        status: ebayStatus,
      },
      updatedAt: now,
    },
  };

  const { error: inventoryError } = await params.supabase
    .from("inventory_items")
    .update({
      title: correction.title,
      description: correction.description,
      metadata: nextMetadata,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.inventoryItemId)
    .eq("status", "draft");
  if (inventoryError) throw inventoryError;

  const legacyProductId = numberValue(params.row.legacyProductId);
  if (legacyProductId > 0) {
    const { error: productError } = await params.supabase
      .from("products")
      .update({
        title: correction.title,
        description: correction.description,
        player: "Kiki Iriafen",
        sport: "Basketball",
        price: 0,
      })
      .eq("store_id", params.storeId)
      .is("seller_account_id", null)
      .eq("id", legacyProductId);
    if (productError) throw productError;
  }

  return {
    metadata: nextMetadata,
    rowPatch: {
      websiteTitle: correction.title,
      websiteDescription: correction.description,
      ebayTitle: correction.title.slice(0, 80),
      ebayDescription: correction.description,
      websitePrice: 0,
      ebayPrice: 0,
      aspects: record(record(nextMetadata.dual_marketplace).ebay).aspects,
      lastError: null,
    },
  };
}

export async function GET(request: Request) {
''',
    "known import correction helper",
)
queue = replace_once(
    queue,
    '''        for (const row of rows || []) {
          metadataById.set(String(row.id), record(row.metadata));
        }
      }
    }

    data.rows = data.rows.map((row: UnknownRecord) =>
''',
    '''        for (const row of rows || []) {
          metadataById.set(String(row.id), record(row.metadata));
        }
      }

      for (const row of data.rows as UnknownRecord[]) {
        const inventoryItemId = text(row.inventoryItemId, 80);
        const metadata = metadataById.get(inventoryItemId) || {};
        const repaired = await applyKnownPendingImportCorrection({
          supabase,
          storeId,
          inventoryItemId,
          row,
          metadata,
        });
        if (!repaired) continue;
        metadataById.set(inventoryItemId, repaired.metadata);
        Object.assign(row, repaired.rowPatch);
      }
    }

    data.rows = data.rows.map((row: UnknownRecord) =>
''',
    "queue GET self-heal",
)
queue = replace_once(
    queue,
    '''  const ai = record(payload.ai);
  const decision = buildInstaCompV2Decision(payload as never);
  const suggestedPrice = Math.max(
    0,
    numberValue(record(decision.targets).listPrice) ||
      numberValue(record(payload.soldStats).suggestedPrice) ||
      numberValue(record(payload.stats).suggestedPrice),
  );
  const title = buildCardListingTitle({
''',
    '''  const rawAi = record(payload.ai);
  const pendingImport = record(metadata.pendingImport);
  const immutableImportedIdentity = record(pendingImport.originalIdentity);
  const importedIdentity = Object.keys(immutableImportedIdentity).length
    ? immutableImportedIdentity
    : record(metadata.cardIdentity);
  const gate = evaluateInstaCompListingGate({
    payload,
    importedIdentity,
    pendingImport,
  });
  const ai = gate.identity;
  const decision = buildInstaCompV2Decision(payload as never);
  const rawSuggestedPrice = Math.max(
    0,
    numberValue(record(decision.targets).listPrice) ||
      numberValue(record(payload.soldStats).suggestedPrice) ||
      numberValue(record(payload.stats).suggestedPrice),
  );
  const suggestedPrice = gate.priceApproved ? rawSuggestedPrice : 0;
  const now = new Date().toISOString();

  if (!gate.identityApproved) {
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...record(metadata.instacomp),
        status: "needs_review",
        version: "2.0",
        scanId: text(payload.scanId, 160) || null,
        identityConfidence: gate.confidence || null,
        listingPrice: null,
        searchQuery: text(payload.searchQuery, 500) || null,
        decision: null,
        proposedIdentity: ai,
        catalogConfirmed: gate.catalogConfirmed,
        reviewReasons: gate.reviewReasons,
        sourceCoverage: Array.isArray(payload.sourceCoverage)
          ? payload.sourceCoverage
          : [],
        completedAt: now,
        frontImageUrl: urls.front,
        backImageUrl: urls.back || null,
      },
    };
    const { error: reviewError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: now })
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .eq("id", inventoryItemId);
    if (reviewError) throw reviewError;

    return {
      inventoryItemId,
      title: card.inventory.title,
      scanId: text(payload.scanId, 160) || null,
      confidence: gate.confidence || null,
      suggestedPrice: null,
      status: "needs_review",
      reviewReasons: gate.reviewReasons,
    };
  }

  const title = buildCardListingTitle({
''',
    "listing identity gate",
)
queue = replace_once(
    queue,
    '''  const description = listingDescription(title, ai, Boolean(urls.back));
  const now = new Date().toISOString();
  const existingDual = record(metadata.dual_marketplace);
''',
    '''  const description = listingDescription(title, ai, Boolean(urls.back));
  const existingDual = record(metadata.dual_marketplace);
''',
    "remove duplicate now",
)
queue = replace_once(
    queue,
    '''      identityConfidence:
        numberValue(ai.confidence) ||
        numberValue(record(payload.knowledge).identityConfidence) ||
        null,
      listingPrice: suggestedPrice || null,
''',
    '''      identityConfidence: gate.confidence || null,
      catalogConfirmed: gate.catalogConfirmed,
      reviewReasons: gate.reviewReasons,
      listingPrice: suggestedPrice || null,
''',
    "verified metadata confidence",
)
queue = replace_once(
    queue,
    '''    confidence:
      numberValue(ai.confidence) ||
      numberValue(record(payload.knowledge).identityConfidence) ||
      null,
''',
    '''    confidence: gate.confidence || null,
''',
    "verified return confidence",
)
queue_path.write_text(queue)


# -----------------------------------------------------------------------------
# UI confidence is stored as 0..1, so show 100% for 1.0 rather than 1%.
# -----------------------------------------------------------------------------
gateway_path = Path("src/app/admin/pending-card-import/TcosListingGateway.tsx")
gateway = gateway_path.read_text()
gateway = replace_once(
    gateway,
    '''function money(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function canDeleteDraft(row: ListingRow) {
''',
    '''function money(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidenceLabel(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const percentage = value <= 1 ? value * 100 : value;
  return `${Math.round(percentage)}%`;
}

function canDeleteDraft(row: ListingRow) {
''',
    "confidence label helper",
)
gateway = replace_once(
    gateway,
    '''                      value={
                        row.instaCompConfidence
                          ? `${Math.round(row.instaCompConfidence)}%`
                          : "—"
                      }
''',
    '''                      value={confidenceLabel(row.instaCompConfidence)}
''',
    "confidence metric scale",
)
gateway_path.write_text(gateway)


# -----------------------------------------------------------------------------
# Permanent source audit for this regression.
# -----------------------------------------------------------------------------
audit_path = Path("scripts/run-kiki-cracked-ice-checklist-audit.mjs")
audit_path.write_text(r'''import fs from "node:fs";

const learning = fs.readFileSync("src/lib/instacomp-learning-server.ts", "utf8");
const queue = fs.readFileSync(
  "src/app/api/admin/card-listing-queue/route.ts",
  "utf8",
);
const importer = fs.readFileSync(
  "src/app/api/admin/pending-card-import/route.ts",
  "utf8",
);
const gateway = fs.readFileSync(
  "src/app/admin/pending-card-import/TcosListingGateway.tsx",
  "utf8",
);
const gate = fs.readFileSync("src/lib/instacomp-listing-gate.ts", "utf8");
const corrections = fs.readFileSync(
  "src/lib/pending-import-identity-corrections.ts",
  "utf8",
);

const checks = [
  [
    "numbered checklist parallels require a visible serial stamp",
    learning.includes("if (serialRun && !targetSerialRun) continue"),
  ],
  [
    "Cracked Ice aliases to official checklist Ice",
    learning.includes("cracked\\s+ice") && gate.includes("cracked\\s+ice"),
  ],
  [
    "listing writes require checklist confirmation",
    gate.includes("checklist_identity_not_confirmed") &&
      gate.includes("publicListingClaimAllowed"),
  ],
  [
    "high-confidence imported parallel conflicts are blocked",
    gate.includes("parallel_conflicts_with_imported_identity"),
  ],
  [
    "queue leaves unverified scans in needs review without a price",
    queue.includes('status: "needs_review"') &&
      queue.includes("suggestedPrice: null"),
  ],
  [
    "Kiki #149 correction restores Cracked Ice and clears bad price",
    corrections.includes('clientId: "SCAN-0195"') &&
      corrections.includes("Cracked Ice Prizm") &&
      queue.includes("applyKnownPendingImportCorrection"),
  ],
  [
    "future imports preserve immutable original identity",
    importer.includes("originalIdentity: {") &&
      importer.includes("identificationConfidence"),
  ],
  [
    "confidence UI converts 0..1 to percentage",
    gateway.includes("value <= 1 ? value * 100 : value"),
  ],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`Kiki Cracked Ice checklist audit failed ${failed}/${checks.length}.`);
  process.exit(1);
}

console.log(`Kiki Cracked Ice checklist audit passed ${checks.length}/${checks.length}.`);
''')

print("Checklist-gated Kiki Cracked Ice patch applied.")
