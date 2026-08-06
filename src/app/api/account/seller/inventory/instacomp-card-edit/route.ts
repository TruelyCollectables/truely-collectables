import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  confirmInstaCompAiLocalLesson,
  hasConfiguredInstaCompAiLocal,
  type InstaCompAiLocalLessonIdentity,
} from "../../../../../../lib/instacomp-ai-local";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function printRun(value: unknown) {
  const raw = clean(value, 30);
  if (!raw) return null;
  const match = raw.match(/(?:\d+\s*)?\/\s*(\d{1,6})\b/);
  if (match) return `/${Number(match[1])}`;
  const digits = raw.match(/^\/?(\d{1,6})$/);
  return digits ? `/${Number(digits[1])}` : null;
}

function printRunNumber(value: string | null) {
  const match = String(value || "").match(/^\/(\d{1,6})$/);
  return match ? Number(match[1]) : null;
}

function sellerLessonIdentity(params: {
  ai: Record<string, unknown>;
  body: Record<string, unknown>;
  parallel: string;
  normalizedPrintRun: string | null;
}): InstaCompAiLocalLessonIdentity {
  const { ai, body, parallel, normalizedPrintRun } = params;
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
    parallel: parallel || null,
    variation: nullableText(body.variation ?? ai.variation, 160),
    // The exact copy number is deliberately not taught as identity. Only the
    // shared print run is retained so 17/99 and 44/99 learn the same card design.
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
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const parsedBody = await request.json().catch(() => ({}));
    const body = record(parsedBody);
    const inventoryItemId = clean(body.inventoryItemId, 100);
    const title = clean(body.title, 300);
    const parallel = clean(body.parallel, 120);
    const normalizedPrintRun = printRun(body.printRun);
    if (!inventoryItemId || !title) {
      return NextResponse.json(
        { error: "Card and title are required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,metadata")
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
    const instaComp = record(metadata.instacomp);
    const ai = record(instaComp.ai);
    const collectibleAsset = record(metadata.collectible_asset);
    const sellerReview = record(metadata.seller_review);
    const editedAt = new Date().toISOString();
    const internalScanId = clean(ai.internalScanId, 100);

    let learningStatus:
      | "stored"
      | "pending_internal_connection"
      | "missing_internal_scan_receipt" = "missing_internal_scan_receipt";
    let learningLessonId: string | null = null;
    let learningError: string | null = null;

    if (internalScanId && hasConfiguredInstaCompAiLocal()) {
      try {
        const lesson = await confirmInstaCompAiLocalLesson({
          scanId: internalScanId,
          identity: sellerLessonIdentity({
            ai,
            body,
            parallel,
            normalizedPrintRun,
          }),
          operatorId: account.id,
          notes: `Seller confirmed private draft ${inventoryItemId}: ${title}`,
        });
        learningStatus = "stored";
        learningLessonId = lesson.lessonId;
      } catch (error) {
        learningStatus = "pending_internal_connection";
        learningError =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "InstaComp internal lesson could not be stored.";
      }
    } else if (internalScanId) {
      learningStatus = "pending_internal_connection";
      learningError =
        "InstaComp internal engine is not configured for this runtime.";
    }

    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...collectibleAsset,
        parallel_name: parallel || null,
        exact_serial_number: normalizedPrintRun,
        print_run: normalizedPrintRun,
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
        lastError: null,
        lastErrorCode: null,
        ai: {
          ...ai,
          player: nullableText(body.player ?? ai.player, 200),
          year: nullableText(body.year ?? ai.year, 20),
          brand: nullableText(body.brand ?? ai.brand, 160),
          setName: nullableText(body.setName ?? ai.setName, 240),
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
          parallel: parallel || null,
          parallelName: parallel || null,
          serialNumber: normalizedPrintRun,
          printRun: normalizedPrintRun,
        },
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ title, metadata: nextMetadata, updated_at: editedAt })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      title,
      parallel: parallel || null,
      printRun: normalizedPrintRun,
      manualIdentityLocked: true,
      identityRefreshRequired: false,
      learningStatus,
      learningLessonId,
      learningError,
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
