import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
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

function normalizeBaseParallel(value: unknown) {
  const normalized = text(value, 120);
  if (!normalized || /^base$/i.test(normalized)) return null;
  return normalized;
}

function correctedTitle(value: unknown, parallel: string | null) {
  let title = text(value, 220) || "Untitled card";
  const baseSelected = !parallel;

  if (baseSelected) {
    title = title
      .replace(/\bBase\s+Silver\s+Prizm\b/gi, "Base")
      .replace(/\bBase\s+(?:Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White)\s+Prizm\b/gi, "Base")
      .replace(/\bBase\s+(?:Cracked\s+Ice|Velocity|Wave)\s+Prizm\b/gi, "Base")
      .replace(/\bBase\s+Base\b/gi, "Base");
  }

  return title.replace(/\s{2,}/g, " ").trim();
}

function identitySnapshot(metadata: JsonRecord) {
  const instaComp = record(metadata.instacomp);
  const ai = record(instaComp.ai);
  return {
    locked: instaComp.manualIdentityLocked === true,
    humanVerified: instaComp.humanVerified === true,
    trustedForIdentity: instaComp.trustedForIdentity === true,
    savedAt: text(instaComp.manualIdentitySavedAt, 80),
    source: text(instaComp.identitySource, 120),
    player: text(ai.player || ai.playerName),
    year: text(ai.year, 10),
    manufacturer: text(ai.manufacturer || ai.brand),
    setName: text(ai.setName || ai.set),
    cardNumber: text(ai.cardNumber || ai.card_number, 80),
    parallel: text(ai.parallel || ai.parallelName, 120),
    variation: text(ai.variation, 120),
    serialNumber: text(ai.serialNumber || ai.printRun, 120),
    sport: text(ai.sport, 120),
    team: text(ai.team, 160),
    isAuto: ai.isAuto === true,
    isRelic: ai.isRelic === true,
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
    .eq("status", "draft");
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
      return Response.json({ success: false, error: scoped.error }, { status: 401 });
    }

    const items = Object.fromEntries(
      (scoped.rows || []).map((row: any) => [
        String(row.id),
        {
          inventoryItemId: String(row.id),
          title: text(row.title, 220),
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
        error: error instanceof Error ? error.message : "Identity status failed.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const scoped = await ownerScopedDrafts(request);
    if (!scoped.account || !scoped.supabase || !scoped.storeId) {
      return Response.json({ success: false, error: scoped.error }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = text(body.action, 40);
    const inventoryItemId = text(body.inventoryItemId, 80);
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
        message: "Identity unlocked. InstaComp may replace it on a future scan.",
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
    const parallel = normalizeBaseParallel(supplied.parallel);
    const title = correctedTitle(body.title || row.title, parallel);
    const player = text(supplied.player, 160);
    const year = text(supplied.year, 10);
    const manufacturer = text(supplied.manufacturer, 120);
    const setName = text(supplied.setName, 180);
    const cardNumber = text(supplied.cardNumber, 80);
    const variation = text(supplied.variation, 120);
    const serialNumber = text(supplied.serialNumber, 120);
    const sport = text(supplied.sport, 120);
    const team = text(supplied.team, 160);
    const isAuto = booleanValue(supplied.isAuto);
    const isRelic = booleanValue(supplied.isRelic);

    if (!title || !player || !year || !cardNumber) {
      return Response.json(
        {
          success: false,
          error: "Title, player, year, and card number are required before locking identity.",
        },
        { status: 400 },
      );
    }

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
      parallel,
      parallelName: parallel,
      variation,
      serialNumber,
      printRun: serialNumber,
      sport,
      team,
      isAuto,
      isRelic,
      confidence: 1,
      notes: "Seller-corrected and locked from the KINGMAKER identity editor.",
    };

    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...previousAsset,
        parallel_name: parallel,
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

    const { error } = await scoped.supabase
      .from("inventory_items")
      .update({ title, metadata: nextMetadata, updated_at: now })
      .eq("id", inventoryItemId)
      .eq("store_id", scoped.storeId)
      .eq("status", "draft");
    if (error) throw error;

    return Response.json({
      success: true,
      message: "Identity saved and locked as the trusted card record.",
      title,
      identity: identitySnapshot(nextMetadata),
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
