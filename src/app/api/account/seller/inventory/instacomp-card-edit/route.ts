import { NextRequest, NextResponse } from "next/server";
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

function nullableText(value: unknown, max = 300) {
  return clean(value, max) || null;
}

function booleanValue(value: unknown) {
  return value === true;
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
    const title = clean(body.title, 300);
    // Manual seller edits are authoritative. Preserve the title exactly as the
    // operator typed it; canonical rewriting is an explicit UI action.
    const displayTitle = title;
    const exactParallel = clean(body.parallel, 120);
    const baseSelected = /^base$/i.test(exactParallel);
    const storedParallel = baseSelected ? null : exactParallel || null;
    const serialStamp = exactSerialStamp(body.printRun);
    const normalizedPrintRun = printRunFromSerial(serialStamp);

    if (!inventoryItemId || !displayTitle) {
      return NextResponse.json(
        { error: "Card and title are required." },
        { status: 400 },
      );
    }
    if (!exactParallel) {
      return NextResponse.json(
        {
          error:
            "Enter Base or the exact checklist parallel. Blank is not accepted as Base.",
        },
        { status: 400 },
      );
    }
    if (clean(body.printRun, 30) && !serialStamp) {
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
      .select("id,seller_account_id,card_uuid,status,metadata,description,category,condition")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    query = isOwner
      ? query.or(
          `seller_account_id.eq.${account.id},seller_account_id.is.null`,
        )
      : query.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await query.maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return NextResponse.json(
        { error: "Pending card was not found." },
        { status: 404 },
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
    const collectibleAsset = record(metadata.collectible_asset);
    const sellerReview = record(metadata.seller_review);
    const editedAt = new Date().toISOString();
    const internalScanId = clean(ai.internalScanId, 100);
    const internalEngineConfigured = hasConfiguredInstaCompAiLocal();
    let effectiveInternalScanId = internalScanId;
    let recoveredInternalCardUuid: string | null = null;
    let learningReceiptRecovered = false;

    let learningStatus:
      | "stored"
      | "pending_internal_connection"
      | "missing_internal_scan_receipt" = "missing_internal_scan_receipt";
    let learningLessonId: string | null = null;
    let learningError: string | null = null;

    if (!effectiveInternalScanId && internalEngineConfigured) {
      try {
        const recoveredReceipt = await recoverMissingInternalScanReceipt({
          supabase,
          inventoryItemId,
          cardUuid: nullableText(item.card_uuid, 100),
          metadata,
        });
        effectiveInternalScanId = recoveredReceipt.scanId;
        recoveredInternalCardUuid = recoveredReceipt.cardUuid;
        learningReceiptRecovered = true;
      } catch (error) {
        learningError =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "The missing Mac-local scan receipt could not be reconstructed.";
        if (!/no distinct stored front\/back image pair/i.test(learningError)) {
          learningStatus = "pending_internal_connection";
        }
      }
    }

    if (effectiveInternalScanId && internalEngineConfigured) {
      try {
        const lesson = await confirmInstaCompAiLocalLesson({
          scanId: effectiveInternalScanId,
          identity: sellerLessonIdentity({
            ai,
            body,
            storedParallel,
            normalizedPrintRun,
          }),
          operatorId: account.id,
          notes: `Seller confirmed private draft ${inventoryItemId}: ${displayTitle}`,
        });
        learningStatus = "stored";
        learningLessonId = lesson.lessonId;
        learningError = null;
      } catch (error) {
        learningStatus = "pending_internal_connection";
        learningError =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "InstaComp internal lesson could not be stored.";
      }
    } else if (effectiveInternalScanId && !internalEngineConfigured) {
      learningStatus = "pending_internal_connection";
      learningError =
        "InstaComp internal engine is not configured for this runtime.";
    } else if (!learningError) {
      learningError =
        "No Mac-local scan receipt or recoverable stored front/back image pair is available for this correction.";
    }

    const manualIdentity = {
      sport: nullableText(body.sport, 100),
      league: nullableText(body.league, 100),
      year: nullableText(body.year, 20),
      manufacturer: nullableText(body.manufacturer, 160),
      brand: nullableText(body.brand, 160),
      product: nullableText(body.product, 160),
      setName: nullableText(body.setName ?? body.set_name, 240),
      subset: nullableText(body.subset, 160),
      player: nullableText(body.player, 200),
      team: nullableText(body.team, 160),
      cardNumber: nullableText(body.cardNumber ?? body.card_number, 80),
      parallel: exactParallel,
      variation: nullableText(body.variation, 160),
      serialNumber: serialStamp,
      printRun: normalizedPrintRun,
      isRookie: booleanValue(body.isRookie),
      isAuto: booleanValue(body.isAuto),
      isRelic: booleanValue(body.isRelic),
      inscription: booleanValue(body.inscription),
      inscriptionText: nullableText(body.inscriptionText, 300),
      memorabiliaType: nullableText(body.memorabiliaType, 160),
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
          player: nullableText(body.player ?? ai.player, 200),
          year: nullableText(body.year ?? ai.year, 20),
          manufacturer: nullableText(body.manufacturer ?? ai.manufacturer ?? ai.brand, 160),
          brand: nullableText(body.brand ?? ai.brand, 160),
          product: nullableText(body.product ?? ai.product, 160),
          setName: nullableText(body.setName ?? ai.setName, 240),
          set_name: nullableText(body.setName ?? body.set_name ?? ai.set_name ?? ai.setName, 240),
          subset: nullableText(body.subset ?? ai.subset, 160),
          league: nullableText(body.league ?? ai.league, 100),
          variation: nullableText(body.variation ?? ai.variation, 160),
          cardNumber: nullableText(body.cardNumber ?? ai.cardNumber, 80),
          team: nullableText(body.team ?? ai.team, 160),
          sport: nullableText(body.sport ?? ai.sport, 100),
          isRookie: booleanValue(body.isRookie ?? ai.isRookie),
          isAuto: booleanValue(body.isAuto ?? ai.isAuto),
          isRelic: booleanValue(body.isRelic ?? ai.isRelic),
          internalInscription: booleanValue(
            body.inscription ?? ai.internalInscription,
          ),
          internalInscriptionText: nullableText(
            body.inscriptionText ?? ai.internalInscriptionText,
            300,
          ),
          internalMemorabiliaType: nullableText(
            body.memorabiliaType ?? ai.internalMemorabiliaType,
            160,
          ),
          parallel: storedParallel,
          parallelName: storedParallel,
          checklistParallel: exactParallel,
          serialNumber: serialStamp,
          serial_number: serialStamp,
          printRun: normalizedPrintRun,
        },
      },
    };

    const { error: updateError } = await supabase
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
      .eq("status", "draft");
    if (updateError) throw updateError;

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
            : "Could not edit pending card.",
      },
      { status: 500 },
    );
  }
}
