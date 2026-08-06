import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { confirmInstaCompKnowledge } from "../../../../../../lib/instacomp-learning-server";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 500) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function booleanValue(value: unknown) {
  return value === true;
}

function explicitParallel(value: unknown) {
  const supplied = text(value, 160);
  if (!supplied) return { supplied: null, stored: null };
  return {
    supplied,
    stored: /^base$/i.test(supplied) ? null : supplied,
  };
}

function identitySnapshot(metadata: JsonRecord) {
  const instaComp = record(metadata.instacomp);
  const ai = record(instaComp.ai);
  const identityComplete = instaComp.identityComplete === true;
  const parallel =
    text(ai.checklistParallel || ai.parallel || ai.parallelName, 160) ||
    (identityComplete ? "Base" : null);
  return {
    locked: instaComp.manualIdentityLocked === true,
    identityComplete,
    humanVerified: instaComp.humanVerified === true,
    trustedForIdentity: instaComp.trustedForIdentity === true,
    savedAt: text(instaComp.manualIdentitySavedAt, 80),
    source: text(instaComp.identitySource, 120),
    player: text(ai.player || ai.playerName),
    year: text(ai.year, 20),
    manufacturer: text(ai.manufacturer || ai.brand),
    setName: text(ai.setName || ai.set),
    cardNumber: text(ai.cardNumber || ai.card_number, 80),
    parallel,
    variation: text(ai.variation, 160),
    serialNumber: text(ai.serialNumber || ai.printRun, 120),
    sport: text(ai.sport, 120),
    team: text(ai.team, 180),
    isAuto: ai.isAuto === true,
    isRelic: ai.isRelic === true,
    learningPromotion: record(instaComp.learningPromotion),
  };
}

async function ownerScopedDrafts(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return { account: null, rows: null, error: "Unauthorized" };

  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const isOwner =
    account.email === "sales@truelycollectables.com" ||
    account.email === "sales@trulycollectables.com";

  let query = supabase
    .from("inventory_items")
    .select("id,seller_account_id,status,title,metadata,updated_at")
    .eq("store_id", storeId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(200);
  query = isOwner
    ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
    : query.eq("seller_account_id", account.id);

  const { data, error } = await query;
  if (error) throw error;
  return { account, rows: data || [], error: null, supabase, storeId };
}

export async function GET(request: Request) {
  try {
    const scoped = await ownerScopedDrafts(request);
    if (!scoped.account) {
      return Response.json(
        { success: false, error: scoped.error },
        { status: 401 },
      );
    }

    const items = Object.fromEntries(
      (scoped.rows || []).map((row: any) => [
        String(row.id),
        {
          inventoryItemId: String(row.id),
          title: text(row.title, 240),
          updatedAt: row.updated_at || null,
          ...identitySnapshot(record(row.metadata)),
        },
      ]),
    );

    return Response.json(
      { success: true, items },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Identity status failed.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const scoped = await ownerScopedDrafts(request);
    if (!scoped.account || !scoped.supabase || !scoped.storeId) {
      return Response.json(
        { success: false, error: scoped.error },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const action = text(body.action, 40);
    const inventoryItemId = text(body.inventoryItemId, 100);
    if (!inventoryItemId) {
      return Response.json(
        { success: false, error: "inventoryItemId is required." },
        { status: 400 },
      );
    }

    const row = (scoped.rows || []).find(
      (candidate: any) => String(candidate.id) === inventoryItemId,
    );
    if (!row) {
      return Response.json(
        { success: false, error: "Pending card was not found." },
        { status: 404 },
      );
    }

    const metadata = record(row.metadata);
    const previousInstaComp = record(metadata.instacomp);
    const previousAi = record(previousInstaComp.ai);
    const previousAsset = record(metadata.collectible_asset);
    const previousReview = record(metadata.seller_review);
    const now = new Date().toISOString();

    if (action === "unlock") {
      const nextMetadata = {
        ...metadata,
        instacomp: {
          ...previousInstaComp,
          manualIdentityLocked: false,
          trustedForIdentity: false,
          identityRefreshRequired: true,
          unlockedAt: now,
          unlockedBy: scoped.account.email || scoped.account.id,
        },
      };
      const { error } = await scoped.supabase
        .from("inventory_items")
        .update({ metadata: nextMetadata, updated_at: now })
        .eq("id", inventoryItemId)
        .eq("store_id", scoped.storeId)
        .eq("status", "draft");
      if (error) throw error;
      return Response.json({
        success: true,
        message: "Identity unlocked. Automatic scanning may replace it.",
        identity: identitySnapshot(nextMetadata),
      });
    }

    if (action !== "save") {
      return Response.json(
        { success: false, error: "Use action save or unlock." },
        { status: 400 },
      );
    }

    const supplied = record(body.identity);
    const parallelChoice = explicitParallel(supplied.parallel);
    if (!parallelChoice.supplied) {
      return Response.json(
        {
          success: false,
          error:
            "Parallel is required. Enter Base or the exact checklist parallel; blank is never treated as Base.",
        },
        { status: 400 },
      );
    }

    const title = text(body.title || row.title, 240) || "Untitled card";
    const player = text(supplied.player, 180);
    const year = text(supplied.year, 20);
    const manufacturer = text(supplied.manufacturer, 120);
    const setName = text(supplied.setName, 200);
    const cardNumber = text(supplied.cardNumber, 80);
    const variation = text(supplied.variation, 160);
    const serialNumber = text(supplied.serialNumber, 120);
    const sport = text(supplied.sport, 120);
    const team = text(supplied.team, 180);
    const isAuto = booleanValue(supplied.isAuto);
    const isRelic = booleanValue(supplied.isRelic);

    if (!player || !year || !cardNumber) {
      return Response.json(
        {
          success: false,
          error:
            "Player, year, and card number are required before locking identity.",
        },
        { status: 400 },
      );
    }

    const storedParallel = parallelChoice.stored;
    const nextAi = {
      ...previousAi,
      player,
      playerName: player,
      year,
      manufacturer,
      brand: manufacturer,
      setName,
      set: setName,
      cardNumber,
      card_number: cardNumber,
      parallel: storedParallel,
      parallelName: storedParallel,
      checklistParallel: parallelChoice.supplied,
      variation,
      serialNumber,
      printRun: serialNumber,
      sport,
      team,
      isAuto,
      isRelic,
      confidence: 1,
      notes:
        "Seller-corrected and locked from KINGMAKER with an explicit parallel choice.",
    };

    const baseNextMetadata: JsonRecord = {
      ...metadata,
      collectible_asset: {
        ...previousAsset,
        parallel_name: storedParallel,
        exact_serial_number: serialNumber,
        print_run: serialNumber,
      },
      seller_review: {
        ...previousReview,
        identity_confirmed: true,
        confirmed_at: now,
        confirmed_by: scoped.account.email || scoped.account.id,
        source: "kingmaker_manual_identity",
      },
      instacomp: {
        ...previousInstaComp,
        ai: nextAi,
        identitySource: "seller_manual_locked",
        identityComplete: true,
        humanVerified: true,
        trustedForIdentity: true,
        manualIdentityEdit: true,
        manualIdentityLocked: true,
        identityRefreshRequired: false,
        manualIdentitySavedAt: now,
        manualIdentitySavedBy: scoped.account.email || scoped.account.id,
        lastStatus: "identity_complete",
        lastStage: "manual_lock",
        lastError: null,
        lastErrorCode: null,
      },
    };

    const { error: saveError } = await scoped.supabase
      .from("inventory_items")
      .update({ title, metadata: baseNextMetadata, updated_at: now })
      .eq("id", inventoryItemId)
      .eq("store_id", scoped.storeId)
      .eq("status", "draft");
    if (saveError) throw saveError;

    const scanId = text(previousInstaComp.scanId, 100);
    let learning: JsonRecord = {
      attempted: false,
      promoted: false,
      scanId,
      checkedAt: new Date().toISOString(),
      error: scanId ? null : "No scan ID was available for knowledge promotion.",
    };

    if (scanId) {
      try {
        const receipt = await confirmInstaCompKnowledge({
          scanId,
          status: "operator_confirmed",
          corrections: {
            player,
            year,
            brand: manufacturer,
            manufacturer,
            setName,
            cardNumber,
            parallel: parallelChoice.supplied,
            variation,
            serialNumber,
            sport,
            team,
            isAuto,
            isRelic,
          },
        });
        learning = {
          attempted: true,
          promoted: true,
          scanId,
          checkedAt: new Date().toISOString(),
          receipt,
          error: null,
        };
      } catch (error) {
        learning = {
          attempted: true,
          promoted: false,
          scanId,
          checkedAt: new Date().toISOString(),
          error:
            error instanceof Error
              ? error.message
              : "Knowledge promotion failed.",
        };
      }
    }

    const finalMetadata: JsonRecord = {
      ...baseNextMetadata,
      instacomp: {
        ...record(baseNextMetadata.instacomp),
        learningPromotion: learning,
      },
    };
    const { error: receiptError } = await scoped.supabase
      .from("inventory_items")
      .update({ metadata: finalMetadata, updated_at: new Date().toISOString() })
      .eq("id", inventoryItemId)
      .eq("store_id", scoped.storeId)
      .eq("status", "draft");
    if (receiptError) {
      learning = {
        ...learning,
        receiptPersistenceError: receiptError.message,
      };
    }

    return Response.json({
      success: true,
      message: "Identity saved and locked as the trusted card record.",
      title,
      identity: identitySnapshot(finalMetadata),
      learning,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Manual identity save failed.",
      },
      { status: 500 },
    );
  }
}
