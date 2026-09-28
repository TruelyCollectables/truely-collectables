import { after, NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  confirmInstaCompAiLocalLesson,
  hasConfiguredInstaCompAiLocal,
  type InstaCompAiLocalLessonIdentity,
} from "../../../../../../lib/instacomp-ai-local";
import {
  getMacMasterListingRow,
  updateMacKingmakerDraft,
} from "../../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function clean(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function listingTitle(value: unknown, max = 300) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function nullableText(value: unknown, max = 300) {
  return clean(value, max) || null;
}

function booleanValue(value: unknown) {
  return value === true;
}

async function persistMasterListingEditToMac(params: {
  item: JsonRecord;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  metadata: JsonRecord;
  updatedAt: string;
}) {
  const { item, title, description, category, condition, metadata } = params;
  const inventoryItemId = clean(
    item.id ?? item.inventoryItemId ?? item.inventory_item_id,
    100,
  );
  if (!inventoryItemId) {
    throw new Error("Mac-local Master Listings row is missing its inventory id.");
  }
  const status = clean(item.status, 80) || "draft";
  if (status === "archived" || status === "sold") {
    throw new Error("This card is no longer editable because it is archived or sold.");
  }
  const updated = await updateMacKingmakerDraft(inventoryItemId, {
    title,
    description,
    category,
    condition,
    status,
    quantity: Number(item.quantity || 0),
    price: Number(item.price || 0),
    imageUrl: nullableText(item.image_url ?? item.imageUrl, 2000),
    player: nullableText(record(metadata.instacomp).manualIdentity && record(record(metadata.instacomp).manualIdentity).player, 200),
    sport: nullableText(record(metadata.instacomp).manualIdentity && record(record(metadata.instacomp).manualIdentity).sport, 100),
    metadata,
  });
  if (!updated) {
    throw new Error("Mac-local KINGMAKER did not return the edited card.");
  }
}


function exactSerialStamp(value: unknown) {
  const raw = clean(value, 30).replace(/\s+/g, "");
  if (!raw) return null;
  if (/^1(?:\/|of)1$/i.test(raw)) return "1/1";
  const full = raw.match(/^(\d{1,6})\/(\d{1,6})$/);
  if (full) return `${Number(full[1])}/${Number(full[2])}`;
  const denominator = raw.match(/^\/?(\d{1,6})$/);
  return denominator ? `/${Number(denominator[1])}` : null;
}

function printRunFromSerial(value: string | null) {
  if (!value) return null;
  if (value === "1/1") return "/1";
  const denominator = value.match(/\/(\d{1,6})$/)?.[1];
  return denominator ? `/${Number(denominator)}` : null;
}

function printRunNumber(value: string | null) {
  const match = String(value || "").match(/^\/(\d{1,6})$/);
  return match ? Number(match[1]) : null;
}

function sellerLessonIdentity(params: {
  ai: JsonRecord;
  body: JsonRecord;
  storedParallel: string | null;
  normalizedPrintRun: string | null;
}): InstaCompAiLocalLessonIdentity {
  const { ai, body, storedParallel, normalizedPrintRun } = params;
  return {
    sport: nullableText(body.sport ?? ai.sport, 100),
    league: nullableText(body.league ?? ai.league, 100),
    year: nullableText(body.year ?? ai.year, 20),
    manufacturer: nullableText(
      body.manufacturer ?? body.brand ?? ai.manufacturer ?? ai.brand,
      160,
    ),
    brand: nullableText(body.brand ?? ai.brand, 160),
    set_name: nullableText(body.setName ?? body.set_name ?? ai.setName, 240),
    subset: nullableText(body.subset ?? ai.subset, 160),
    player: nullableText(body.player ?? ai.player, 200),
    team: nullableText(body.team ?? ai.team, 160),
    card_number: nullableText(
      body.cardNumber ?? body.card_number ?? ai.cardNumber,
      80,
    ),
    parallel: storedParallel,
    variation: nullableText(body.variation ?? ai.variation, 160),
    // Reusable learning stores the shared denominator, not this copy's numerator.
    serial_number: normalizedPrintRun,
    serial_run: printRunNumber(normalizedPrintRun),
    rookie: booleanValue(body.isRookie ?? ai.isRookie),
    autograph: booleanValue(body.isAuto ?? ai.isAuto),
    inscription: booleanValue(
      body.inscription ?? ai.internalInscription ?? ai.inscription,
    ),
    inscription_text: nullableText(
      body.inscriptionText ?? ai.internalInscriptionText ?? ai.inscriptionText,
      300,
    ),
    memorabilia: booleanValue(body.isRelic ?? ai.isRelic),
    memorabilia_type: nullableText(
      body.memorabiliaType ??
        ai.internalMemorabiliaType ??
        ai.memorabiliaType,
      160,
    ),
  };
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isOwner) {
      await ensureAccountStoreMembership({
        accountId: account.id,
        role: "seller",
        status: "active",
      });
    }

    const parsedBody = await request.json().catch(() => ({}));
    const body = record(parsedBody);
    const inventoryItemId = clean(body.inventoryItemId, 100);
    const title = listingTitle(body.title, 300);
    // Manual seller edits are authoritative. Preserve the title exactly as the
    // operator typed it; canonical rewriting is an explicit UI action.
    const displayTitle = title;
    const identityEdited = body.identityEdited !== false;
    const exactParallel = clean(body.parallel, 120);
    const baseSelected = /^base$/i.test(exactParallel);
    const storedParallel = baseSelected ? null : exactParallel || null;
    const serialStamp = exactSerialStamp(body.printRun);
    const normalizedPrintRun = printRunFromSerial(serialStamp);

    if (!inventoryItemId || !displayTitle.trim()) {
      return NextResponse.json(
        { error: "Card and title are required." },
        { status: 400 },
      );
    }
    if (identityEdited && !exactParallel) {
      return NextResponse.json(
        {
          error:
            "Enter Base or the exact checklist parallel. Blank is not accepted as Base.",
        },
        { status: 400 },
      );
    }
    if (identityEdited && clean(body.printRun, 30) && !serialStamp) {
      return NextResponse.json(
        {
          error:
            "Serial must be an exact stamp such as 17/99, 1/1, or a denominator such as /99.",
        },
        { status: 400 },
      );
    }

    // InstaComp/KINGMAKER identity and listing truth is Mac-local only.
    const item = await getMacMasterListingRow(inventoryItemId);
    if (!item) {
      return NextResponse.json(
        { error: "Mac-local Master Listings card was not found." },
        { status: 404 },
      );
    }
    if (item.status === "archived" || item.status === "sold") {
      return NextResponse.json(
        { error: "This card is no longer editable because it is archived or sold." },
        { status: 409 },
      );
    }

    const metadata = record(item.metadata);
    const nextDescription = Object.prototype.hasOwnProperty.call(body, "description")
      ? nullableText(body.description, 5000)
      : nullableText(item.description, 5000);
    const nextCategory = Object.prototype.hasOwnProperty.call(body, "category")
      ? nullableText(body.category, 160)
      : nullableText(item.category, 160);
    const nextCondition = Object.prototype.hasOwnProperty.call(body, "condition")
      ? nullableText(body.condition, 120)
      : nullableText(item.condition, 120);
    const instaComp = record(metadata.instacomp);
    const ai = record(instaComp.ai);
    const existingManualIdentity = record(instaComp.manualIdentity);
    const checklistIdentity = record(instaComp.checklistIdentity);
    const checklistLockedFields = record(checklistIdentity.lockedFields);
    const identityFallback = {
      ...checklistLockedFields,
      ...ai,
      ...existingManualIdentity,
    };
    const collectibleAsset = record(metadata.collectible_asset);
    const sellerReview = record(metadata.seller_review);
    const editedAt = new Date().toISOString();

    if (!identityEdited) {
      const nextMetadata = {
        ...metadata,
        instacomp: {
          ...instaComp,
          manualListingTitle: displayTitle,
          manualListingTitleLocked: true,
          manualListingTitleSavedAt: editedAt,
          manualListingTitleSavedBy: account.id,
        },
      };

      await persistMasterListingEditToMac({
        item: item as JsonRecord,
        title: displayTitle,
        description: nextDescription,
        category: nextCategory,
        condition: nextCondition,
        metadata: nextMetadata,
        updatedAt: editedAt,
      });

      return NextResponse.json({
        success: true,
        title: displayTitle,
        description: nextDescription,
        category: nextCategory,
        condition: nextCondition,
        manualListingTitleLocked: true,
        manualIdentityLocked: instaComp.manualIdentityLocked === true,
        identityRefreshRequired: instaComp.identityRefreshRequired === true,
        identityUnchanged: true,
        learningStatus: "unchanged",
        learningLessonId: nullableText(instaComp.learningLessonId, 100),
        learningError: null,
        learningReceiptRecovered: false,
      });
    }

    const internalScanId = clean(ai.internalScanId, 100);
    const internalEngineConfigured = hasConfiguredInstaCompAiLocal();
    const effectiveInternalScanId = internalScanId;
    const learningReceiptRecovered = false;
    const learningStatus = internalEngineConfigured
      ? "queued"
      : "pending_internal_connection";
    const learningLessonId: string | null = null;
    const learningError = internalEngineConfigured
      ? null
      : "InstaComp internal engine is not configured for this runtime.";

    const sparseIdentityPayload =
      [
        clean(body.year, 20),
        clean(body.product, 160),
        clean(body.player, 200),
        clean(body.cardNumber ?? body.card_number, 80),
      ].filter(Boolean).length < 3;
    const resolvedText = (
      bodyValue: unknown,
      fallbackValue: unknown,
      max: number,
    ) => nullableText(bodyValue, max) || nullableText(fallbackValue, max);
    const resolvedBoolean = (bodyValue: unknown, fallbackValue: unknown) =>
      sparseIdentityPayload ? fallbackValue === true : booleanValue(bodyValue);

    const manualIdentity = {
      sport: resolvedText(body.sport, identityFallback.sport, 100),
      league: resolvedText(body.league, identityFallback.league, 100),
      year: resolvedText(body.year, identityFallback.year, 20),
      manufacturer: resolvedText(
        body.manufacturer,
        identityFallback.manufacturer ?? identityFallback.brand,
        160,
      ),
      brand: resolvedText(
        body.brand,
        identityFallback.brand ?? identityFallback.manufacturer,
        160,
      ),
      product: resolvedText(body.product, identityFallback.product, 160),
      setName: resolvedText(
        body.setName ?? body.set_name,
        identityFallback.setName ?? identityFallback.set_name,
        240,
      ),
      subset: resolvedText(body.subset, identityFallback.subset, 160),
      player: resolvedText(
        body.player,
        identityFallback.player ?? identityFallback.playerName,
        200,
      ),
      team: resolvedText(body.team, identityFallback.team, 160),
      cardNumber: resolvedText(
        body.cardNumber ?? body.card_number,
        identityFallback.cardNumber ?? identityFallback.card_number,
        80,
      ),
      parallel: exactParallel,
      variation: resolvedText(body.variation, identityFallback.variation, 160),
      serialNumber:
        serialStamp ||
        nullableText(
          identityFallback.serialNumber ?? identityFallback.serial_number,
          30,
        ),
      printRun:
        normalizedPrintRun ||
        nullableText(identityFallback.printRun ?? identityFallback.serialRun, 30),
      isRookie: resolvedBoolean(body.isRookie, identityFallback.isRookie),
      isAuto: resolvedBoolean(body.isAuto, identityFallback.isAuto),
      isRelic: resolvedBoolean(body.isRelic, identityFallback.isRelic),
      inscription: resolvedBoolean(
        body.inscription,
        identityFallback.inscription ?? identityFallback.internalInscription,
      ),
      inscriptionText: resolvedText(
        body.inscriptionText,
        identityFallback.inscriptionText ?? identityFallback.internalInscriptionText,
        300,
      ),
      memorabiliaType: resolvedText(
        body.memorabiliaType,
        identityFallback.memorabiliaType ?? identityFallback.internalMemorabiliaType,
        160,
      ),
      savedAt: editedAt,
      savedBy: account.id,
      source: "seller_manual_edit",
    };

    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...collectibleAsset,
        parallel_name: storedParallel,
        exact_serial_number: serialStamp,
        print_run: normalizedPrintRun,
        serial_run: printRunNumber(normalizedPrintRun),
      },
      seller_review: {
        ...sellerReview,
        identity_confirmed: true,
        confirmed_at: editedAt,
        confirmed_by: account.id,
        edited_at: editedAt,
        edited_by: account.id,
        identity_source: "seller_manual_edit",
      },
      instacomp: {
        ...instaComp,
        manualListingTitle: displayTitle,
        manualListingTitleLocked: true,
        manualListingTitleSavedAt: editedAt,
        manualListingTitleSavedBy: account.id,
        humanVerified: true,
        trustedForIdentity: true,
        manualIdentityEdit: true,
        manualIdentityLocked: true,
        manualIdentity,
        identityRefreshRequired: false,
        identitySource: "seller_manual_edit",
        identityComplete: true,
        learningStatus,
        learningLessonId,
        learningError,
        learningUpdatedAt: editedAt,
        pricingStatus: "manual_identity_saved_pricing_pending",
        pricingReason:
          "Seller identity is locked. Pricing may run without replacing the seller correction.",
        suggestedPrice: null,
        lastStatus: "identity_complete",
        lastStage: "manual_lock",
        lastError: null,
        lastErrorCode: null,
        ai: {
          ...ai,
          internalScanId: effectiveInternalScanId || null,
          internalCardUuid: nullableText(ai.internalCardUuid, 100),
          player: manualIdentity.player,
          year: manualIdentity.year,
          manufacturer: manualIdentity.manufacturer,
          brand: manualIdentity.brand,
          product: manualIdentity.product,
          setName: manualIdentity.setName,
          set_name: manualIdentity.setName,
          subset: manualIdentity.subset,
          league: manualIdentity.league,
          variation: manualIdentity.variation,
          cardNumber: manualIdentity.cardNumber,
          team: manualIdentity.team,
          sport: manualIdentity.sport,
          isRookie: manualIdentity.isRookie,
          isAuto: manualIdentity.isAuto,
          isRelic: manualIdentity.isRelic,
          internalInscription: manualIdentity.inscription,
          internalInscriptionText: manualIdentity.inscriptionText,
          internalMemorabiliaType: manualIdentity.memorabiliaType,
          parallel: storedParallel,
          parallelName: storedParallel,
          checklistParallel: exactParallel,
          serialNumber: manualIdentity.serialNumber,
          serial_number: manualIdentity.serialNumber,
          printRun: manualIdentity.printRun,
        },
      },
    };

    await persistMasterListingEditToMac({
      item: item as JsonRecord,
      title: displayTitle,
      description: nextDescription,
      category: nextCategory,
      condition: nextCondition,
      metadata: nextMetadata,
      updatedAt: editedAt,
    });

    if (internalEngineConfigured) {
      const lessonIdentity = sellerLessonIdentity({
        ai,
        body,
        storedParallel,
        normalizedPrintRun,
      });
      after(async () => {
        let backgroundStatus:
          | "stored"
          | "pending_internal_connection"
          | "missing_internal_scan_receipt" = internalScanId
            ? "pending_internal_connection"
            : "missing_internal_scan_receipt";
        let backgroundLessonId: string | null = null;
        let backgroundError: string | null = internalScanId
          ? null
          : "No Mac-local scan receipt is attached to this card; seller correction remains locked locally.";

        if (internalScanId) {
          try {
            const lesson = await confirmInstaCompAiLocalLesson({
              scanId: internalScanId,
              identity: lessonIdentity,
              operatorId: account.id,
              notes: `Seller confirmed inventory item ${inventoryItemId}: ${displayTitle}`,
            });
            backgroundStatus = "stored";
            backgroundLessonId = lesson.lessonId;
            backgroundError = null;
          } catch (error) {
            backgroundStatus = "pending_internal_connection";
            backgroundError =
              error instanceof Error
                ? error.message.slice(0, 500)
                : "InstaComp internal lesson could not be stored.";
          }
        }

        try {
          const current = await getMacMasterListingRow(inventoryItemId);
          if (!current) return;
          const currentMetadata = record(current.metadata);
          const currentReview = record(currentMetadata.seller_review);
          if (clean(currentReview.edited_at, 100) !== editedAt) return;

          const currentInstaComp = record(currentMetadata.instacomp);
          const learningUpdatedAt = new Date().toISOString();
          const patchedMetadata = {
            ...currentMetadata,
            instacomp: {
              ...currentInstaComp,
              learningStatus: backgroundStatus,
              learningLessonId: backgroundLessonId,
              learningError: backgroundError,
              learningUpdatedAt,
            },
          };
          await persistMasterListingEditToMac({
            item: current,
            title: clean(current.title, 300) || displayTitle,
            description: nullableText(current.description, 5000),
            category: nullableText(current.category, 160),
            condition: nullableText(current.condition, 120),
            metadata: patchedMetadata,
            updatedAt: learningUpdatedAt,
          });
        } catch (error) {
          console.error("KINGMAKER Mac-local learning persistence failed", {
            inventoryItemId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    return NextResponse.json({
      success: true,
      title: displayTitle,
      description: nextDescription,
      category: nextCategory,
      condition: nextCondition,
      parallel: exactParallel,
      serialNumber: serialStamp,
      printRun: normalizedPrintRun,
      manualIdentityLocked: true,
      identityRefreshRequired: false,
      learningStatus,
      learningLessonId,
      learningError,
      learningReceiptRecovered,
      internalScanId: effectiveInternalScanId || null,
      published: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not edit card.",
      },
      { status: 500 },
    );
  }
}
