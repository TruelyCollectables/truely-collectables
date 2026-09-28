import { after, NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  archiveInstaCompAiLocalSupervisedScan,
  confirmInstaCompAiLocalLesson,
  hasConfiguredInstaCompAiLocal,
  type InstaCompAiLocalLessonIdentity,
} from "../../../../../../lib/instacomp-ai-local";
import { projectMacMasterListingRows } from "../../../../../../lib/kingmaker-mac-scan-server";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

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
  const { item, title, description, category, condition, metadata, updatedAt } = params;
  await projectMacMasterListingRows([
    {
      inventoryItemId: clean(item.id, 100),
      legacyProductId: item.legacy_product_id,
      cardUuid: nullableText(item.card_uuid, 100),
      sku: nullableText(item.sku, 200),
      title,
      description,
      category,
      condition,
      status: clean(item.status, 80) || "draft",
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      imageUrl: nullableText(item.image_url, 2000),
      metadata,
      createdAt: nullableText(item.created_at, 100),
      updatedAt,
    },
  ]);
}


type StoredLearningImage = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function trustedStorageHost() {
  const configured =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  try {
    return new URL(configured).host.toLowerCase();
  } catch {
    return "";
  }
}

function learningImagePair(rows: StoredLearningImage[], metadata: JsonRecord) {
  const sorted = [...rows]
    .filter((row) => Boolean(nullableText(row.image_url, 2000)))
    .sort((left, right) => {
      if (left.is_primary === true && right.is_primary !== true) return -1;
      if (right.is_primary === true && left.is_primary !== true) return 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    });
  const frontRow =
    sorted.find((row) => row.is_primary === true) ||
    sorted.find((row) => /\bfront\b/i.test(row.alt_text || "")) ||
    sorted[0] ||
    null;
  const backRow =
    sorted.find((row) => /\bback\b/i.test(row.alt_text || "")) ||
    sorted.find(
      (row) => row !== frontRow && row.image_url !== frontRow?.image_url,
    ) ||
    null;
  const instaComp = record(metadata.instacomp);
  const recovered = record(instaComp.recoveredImageUrls);
  const sourceImages = Array.isArray(instaComp.sourceImageUrls)
    ? instaComp.sourceImageUrls
    : [];
  const front =
    nullableText(frontRow?.image_url, 2000) ||
    nullableText(recovered.front, 2000) ||
    nullableText(sourceImages[0], 2000);
  const back =
    nullableText(backRow?.image_url, 2000) ||
    nullableText(recovered.back, 2000) ||
    nullableText(sourceImages[1], 2000);
  return front && back && front !== back ? { front, back } : null;
}

async function learningImageBlob(url: string, side: "front" | "back") {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Stored ${side} image URL is invalid.`);
  }
  const storageHost = trustedStorageHost();
  if (
    parsed.protocol !== "https:" ||
    !storageHost ||
    parsed.host.toLowerCase() !== storageHost ||
    !parsed.pathname.startsWith("/storage/v1/object/")
  ) {
    throw new Error(
      `Stored ${side} image is not in the trusted Supabase storage origin.`,
    );
  }
  const response = await fetch(parsed, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Stored ${side} image returned HTTP ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1_000 || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error(`Stored ${side} image has an invalid size.`);
  }
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Stored ${side} image is not an image response.`);
  }
  return new Blob([bytes], { type: contentType });
}

async function recoverMissingInternalScanReceipt(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  inventoryItemId: string;
  cardUuid: string | null;
  metadata: JsonRecord;
}) {
  const { data, error } = await params.supabase
    .from("inventory_images")
    .select("image_url,alt_text,sort_order,is_primary")
    .eq("inventory_item_id", params.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const pair = learningImagePair(
    (data || []) as StoredLearningImage[],
    params.metadata,
  );
  if (!pair) {
    throw new Error(
      "No distinct stored front/back image pair is available to reconstruct the Mac-local learning receipt.",
    );
  }
  const [front, back] = await Promise.all([
    learningImageBlob(pair.front, "front"),
    learningImageBlob(pair.back, "back"),
  ]);
  const archive = await archiveInstaCompAiLocalSupervisedScan({
    front,
    back,
    cardUuid: params.cardUuid,
  });
  return { scanId: archive.scan_id, cardUuid: archive.card_uuid };
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

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

    let query = supabase
      .from("inventory_items")
      .select("id,seller_account_id,card_uuid,legacy_product_id,sku,status,quantity,price,image_url,created_at,metadata,description,category,condition")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    query = isOwner
      ? query.or(
          `seller_account_id.eq.${account.id},seller_account_id.is.null`,
        )
      : query.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await query.maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return NextResponse.json(
        { error: "Card was not found." },
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
      : item.description || null;
    const nextCategory = Object.prototype.hasOwnProperty.call(body, "category")
      ? nullableText(body.category, 160)
      : item.category || null;
    const nextCondition = Object.prototype.hasOwnProperty.call(body, "condition")
      ? nullableText(body.condition, 120)
      : item.condition || null;
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

      const { data: updatedItem, error: updateError } = await supabase
        .from("inventory_items")
        .update({
          title: displayTitle,
          description: nextDescription,
          category: nextCategory,
          condition: nextCondition,
          metadata: nextMetadata,
          updated_at: editedAt,
        })
        .eq("id", inventoryItemId)
        .eq("store_id", storeId)
        .neq("status", "archived")
        .neq("status", "sold")
        .select("id,status")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updatedItem) {
        return NextResponse.json(
          { error: "This card changed status before the edit could be saved. Reload Master Listings and try again." },
          { status: 409 },
        );
      }

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
    const recoveredInternalCardUuid: string | null = null;
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
          internalCardUuid:
            recoveredInternalCardUuid || nullableText(ai.internalCardUuid, 100),
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

    const { data: updatedItem, error: updateError } = await supabase
      .from("inventory_items")
      .update({
        title: displayTitle,
        description: nextDescription,
        category: nextCategory,
        condition: nextCondition,
        metadata: nextMetadata,
        updated_at: editedAt,
        ...(!item.card_uuid && recoveredInternalCardUuid
          ? { card_uuid: recoveredInternalCardUuid }
          : {}),
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .neq("status", "archived")
      .neq("status", "sold")
      .select("id,status")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedItem) {
      return NextResponse.json(
        { error: "This card changed status before the edit could be saved. Reload Master Listings and try again." },
        { status: 409 },
      );
    }

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
        const backgroundSupabase = createSupabaseServerClient({ admin: true });
        let backgroundScanId = internalScanId;
        let backgroundCardUuid: string | null = null;
        let backgroundStatus:
          | "stored"
          | "pending_internal_connection"
          | "missing_internal_scan_receipt" = "missing_internal_scan_receipt";
        let backgroundLessonId: string | null = null;
        let backgroundError: string | null = null;

        if (!backgroundScanId) {
          try {
            const recoveredReceipt = await recoverMissingInternalScanReceipt({
              supabase: backgroundSupabase,
              inventoryItemId,
              cardUuid: nullableText(item.card_uuid, 100),
              metadata: nextMetadata,
            });
            backgroundScanId = recoveredReceipt.scanId;
            backgroundCardUuid = recoveredReceipt.cardUuid;
          } catch (error) {
            backgroundError =
              error instanceof Error
                ? error.message.slice(0, 500)
                : "The missing Mac-local scan receipt could not be reconstructed.";
            if (!/no distinct stored front\/back image pair/i.test(backgroundError)) {
              backgroundStatus = "pending_internal_connection";
            }
          }
        }

        if (backgroundScanId) {
          try {
            const lesson = await confirmInstaCompAiLocalLesson({
              scanId: backgroundScanId,
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
        } else if (!backgroundError) {
          backgroundError =
            "No Mac-local scan receipt or recoverable stored front/back image pair is available for this correction.";
        }

        try {
          const { data: current, error: currentError } = await backgroundSupabase
            .from("inventory_items")
            .select("metadata,card_uuid,updated_at,status")
            .eq("id", inventoryItemId)
            .eq("store_id", storeId)
            .neq("status", "archived")
            .neq("status", "sold")
            .maybeSingle();
          if (currentError || !current) return;

          const currentMetadata = record(current.metadata);
          const currentReview = record(currentMetadata.seller_review);
          if (clean(currentReview.edited_at, 100) !== editedAt) return;

          const currentInstaComp = record(currentMetadata.instacomp);
          const currentAi = record(currentInstaComp.ai);
          const learningUpdatedAt = new Date().toISOString();
          const patchedMetadata = {
            ...currentMetadata,
            instacomp: {
              ...currentInstaComp,
              learningStatus: backgroundStatus,
              learningLessonId: backgroundLessonId,
              learningError: backgroundError,
              learningUpdatedAt,
              ai: {
                ...currentAi,
                internalScanId: backgroundScanId || null,
                internalCardUuid:
                  backgroundCardUuid ||
                  nullableText(currentAi.internalCardUuid, 100),
              },
            },
          };

          const patch: Record<string, unknown> = {
            metadata: patchedMetadata,
            updated_at: learningUpdatedAt,
          };
          if (!current.card_uuid && backgroundCardUuid) {
            patch.card_uuid = backgroundCardUuid;
          }
          await backgroundSupabase
            .from("inventory_items")
            .update(patch)
            .eq("id", inventoryItemId)
            .eq("store_id", storeId)
            .neq("status", "archived")
            .neq("status", "sold")
            .eq("updated_at", current.updated_at);
        } catch (error) {
          console.error("KINGMAKER background learning persistence failed", {
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
