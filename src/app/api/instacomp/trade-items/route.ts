import { randomUUID } from "crypto";
import { buildInstaCompDraftTitle } from "../../../../lib/instacomp-draft-title";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  INSTACOMP_JOB_ITEM_TABLE,
  INSTACOMP_JOB_TABLE,
  InstaCompJobServerError,
  instaCompJobErrorResponse,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  throwInstaCompDatabaseError,
} from "../../../../lib/instacomp-job-server";

export const dynamic = "force-dynamic";

type TradeItemRequest = {
  clientId?: unknown;
  scanId?: unknown;
  persistentJobId?: unknown;
  persistentItemId?: unknown;
  title?: unknown;
  fileName?: unknown;
  hasBackImage?: unknown;
  searchQuery?: unknown;
  marketPrice?: unknown;
  ai?: {
    player?: string | null;
    year?: string | null;
    brand?: string | null;
    setName?: string | null;
    cardNumber?: string | null;
    parallel?: string | null;
    serialNumber?: string | null;
    gradingCompany?: string | null;
    gradeValue?: string | null;
    certificationNumber?: string | null;
    certificationLookupUrl?: string | null;
    gradingEvidence?: string | null;
    team?: string | null;
    sport?: string | null;
    isRookie?: boolean;
    isAuto?: boolean;
    isRelic?: boolean;
    conditionGuess?: string | null;
    confidence?: number | null;
    notes?: string | null;
  } | null;
  stats?: unknown;
  soldStats?: unknown;
};

function cleanText(value: unknown, maxLength = 300) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanUuid(value: unknown) {
  const text = cleanText(value, 80);
  return text &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      text,
    )
    ? text
    : null;
}

function moneyNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function compactRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMissingTradeHandoffSchema(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_collection_items") ||
    message.includes("trade_collection_item_id") ||
    message.includes("trade_available_at")
  );
}

function categoryFromAi(ai: TradeItemRequest["ai"]) {
  const sport = cleanText(ai?.sport, 80)?.toLowerCase();

  if (!sport) return "cards";
  if (sport.includes("hockey")) return "hockey cards";
  if (sport.includes("baseball")) return "baseball cards";
  if (sport.includes("basketball")) return "basketball cards";
  if (sport.includes("football")) return "football cards";
  if (sport.includes("soccer")) return "soccer cards";
  if (sport.includes("wrestling")) return "wrestling cards";
  if (sport.includes("racing")) return "racing cards";

  return "cards";
}

function conditionFromAi(ai: TradeItemRequest["ai"]) {
  return cleanText(ai?.conditionGuess, 120) || null;
}

function tradeTitle(item: TradeItemRequest, fallback: string) {
  const requested = cleanText(item.title, 220);

  if (requested) return requested;

  if (item.ai) {
    return buildInstaCompDraftTitle(
      {
        year: cleanText(item.ai.year, 40),
        brand: cleanText(item.ai.brand, 80),
        setName: cleanText(item.ai.setName, 140),
        player: cleanText(item.ai.player, 120),
        cardNumber: cleanText(item.ai.cardNumber, 60),
        parallel: cleanText(item.ai.parallel, 140),
        serialNumber: cleanText(item.ai.serialNumber, 80),
        isRookie: item.ai.isRookie === true,
      },
      fallback,
    );
  }

  return fallback;
}

async function findExistingTradeCollectionItem(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  storeId: string;
  accountId: string;
  collectionItemId: string;
}) {
  const { data, error } = await params.supabase
    .from("account_collection_items")
    .select("id,title,metadata")
    .eq("id", params.collectionItemId)
    .eq("store_id", params.storeId)
    .eq("account_id", params.accountId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);

    if (actor.type !== "seller") {
      throw new InstaCompJobServerError(
        "Sign in as the card owner before adding a scan to Available for Trade.",
        403,
        "INSTACOMP_TRADE_REQUIRES_SELLER_ACCOUNT",
      );
    }

    const body = (await request.json().catch(() => ({}))) as TradeItemRequest;
    const supabase = requireInstaCompJobSupabase();
    const storeId = getActiveStoreId();
    const accountId = actor.sellerAccountId;
    const persistentJobId = cleanUuid(body.persistentJobId);
    const persistentItemId = cleanUuid(body.persistentItemId);
    const clientId = cleanText(body.clientId, 200);
    const scanId = cleanText(body.scanId, 120);
    const now = new Date().toISOString();

    if (Boolean(body.persistentJobId) !== Boolean(persistentJobId)) {
      throw new InstaCompJobServerError(
        "Persistent InstaComp job ID is invalid.",
        400,
        "INSTACOMP_TRADE_INVALID_JOB_ID",
      );
    }

    if (Boolean(body.persistentItemId) !== Boolean(persistentItemId)) {
      throw new InstaCompJobServerError(
        "Persistent InstaComp item ID is invalid.",
        400,
        "INSTACOMP_TRADE_INVALID_ITEM_ID",
      );
    }

    if (Boolean(persistentJobId) !== Boolean(persistentItemId)) {
      throw new InstaCompJobServerError(
        "Persistent InstaComp job and item IDs must be provided together.",
        400,
        "INSTACOMP_TRADE_PERSISTENT_IDS_REQUIRED",
      );
    }

    let persistedItem: Record<string, any> | null = null;

    if (persistentJobId && persistentItemId) {
      const { data: job, error: jobError } = await supabase
        .from(INSTACOMP_JOB_TABLE)
        .select("id,status,seller_account_id,store_id")
        .eq("id", persistentJobId)
        .eq("store_id", storeId)
        .eq("seller_account_id", accountId)
        .maybeSingle();

      if (jobError) throwInstaCompDatabaseError(jobError);

      if (!job) {
        throw new InstaCompJobServerError(
          "The persistent InstaComp job was not found for this seller.",
          404,
          "INSTACOMP_TRADE_JOB_NOT_FOUND",
        );
      }

      const { data: item, error: itemError } = await supabase
        .from(INSTACOMP_JOB_ITEM_TABLE)
        .select(
          "id,job_id,status,draft_inventory_item_id,trade_collection_item_id,result_payload,front_original_filename,back_storage_path",
        )
        .eq("id", persistentItemId)
        .eq("job_id", persistentJobId)
        .maybeSingle();

      if (itemError) {
        if (isMissingTradeHandoffSchema(itemError)) {
          throw new InstaCompJobServerError(
            "Apply the InstaComp trade handoff migration before using Available for Trade.",
            503,
            "INSTACOMP_TRADE_SCHEMA_MISSING",
          );
        }

        throwInstaCompDatabaseError(itemError);
      }

      if (!item) {
        throw new InstaCompJobServerError(
          "The persistent InstaComp row was not found.",
          404,
          "INSTACOMP_TRADE_ITEM_NOT_FOUND",
        );
      }

      if (!["completed", "review_required"].includes(String(item.status))) {
        throw new InstaCompJobServerError(
          "Finish or review the InstaComp scan before adding it to Available for Trade.",
          409,
          "INSTACOMP_TRADE_SCAN_NOT_DONE",
        );
      }

      if (item.draft_inventory_item_id) {
        throw new InstaCompJobServerError(
          "This InstaComp row already created a sell draft and cannot also be marked Available for Trade.",
          409,
          "INSTACOMP_TRADE_BLOCKED_BY_SELL_DRAFT",
        );
      }

      if (item.trade_collection_item_id) {
        const existing = await findExistingTradeCollectionItem({
          supabase,
          storeId,
          accountId,
          collectionItemId: String(item.trade_collection_item_id),
        });

        return Response.json({
          success: true,
          alreadyExisted: true,
          collectionItemId: item.trade_collection_item_id,
          title: existing?.title || cleanText(body.title, 220) || "Available trade card",
        });
      }

      persistedItem = item;
    }

    const persistedPayload = compactRecord(persistedItem?.result_payload);
    const ai = Object.keys(compactRecord(persistedPayload.ai)).length
      ? (compactRecord(persistedPayload.ai) as TradeItemRequest["ai"])
      : body.ai && typeof body.ai === "object"
        ? body.ai
        : null;
    const fallbackTitle =
      cleanText(persistedItem?.front_original_filename, 180) ||
      cleanText(body.fileName, 180) ||
      "InstaComp trade card";
    const title = tradeTitle({ ...body, ai }, fallbackTitle);
    const marketPrice =
      moneyNumber(compactRecord(persistedPayload.stats).suggestedPrice) ??
      moneyNumber(body.marketPrice);
    const searchQuery =
      cleanText(persistedPayload.searchQuery, 500) ||
      cleanText(body.searchQuery, 500) ||
      title;
    const collectionItemId = randomUUID();
    const metadata = {
      instacomp: {
        destination: "available_for_trade",
        source: "batch_scan",
        persistentJobId,
        persistentItemId,
        clientId,
        scanId,
        searchQuery,
        hasBackImage: Boolean(
          persistedItem?.back_storage_path || body.hasBackImage,
        ),
        ai,
        stats: compactRecord(persistedPayload.stats),
        soldStats: compactRecord(persistedPayload.soldStats || body.soldStats),
        trade: {
          status: "available",
          availableAt: now,
          exclusiveWithSellDraft: true,
        },
      },
    };

    const { data: collectionItem, error: insertError } = await supabase
      .from("account_collection_items")
      .insert({
        id: collectionItemId,
        account_id: accountId,
        store_id: storeId,
        title,
        category: categoryFromAi(ai),
        item_type: "card",
        acquisition_source: "instacomp",
        estimated_value: marketPrice,
        value_confidence: marketPrice ? "instacomp_market" : "needs_review",
        grade_company: cleanText(ai?.gradingCompany, 80),
        grade_value: cleanText(ai?.gradeValue, 40),
        certification_number: cleanText(ai?.certificationNumber, 80),
        condition: conditionFromAi(ai),
        ownership_status: "owned",
        visibility: "community",
        is_favorite: false,
        notes:
          "Available for Trade from InstaComp. This card is trade-only unless the owner removes the trade handoff.",
        metadata,
      })
      .select("id,title")
      .single();

    if (insertError) {
      if (isMissingTradeHandoffSchema(insertError)) {
        throw new InstaCompJobServerError(
          "Collector trade inventory is not available until the collection migration is applied.",
          503,
          "INSTACOMP_TRADE_COLLECTION_SCHEMA_MISSING",
        );
      }

      throwInstaCompDatabaseError(insertError);
    }

    if (persistentItemId) {
      const { data: linkedItem, error: linkError } = await supabase
        .from(INSTACOMP_JOB_ITEM_TABLE)
        .update({
          trade_collection_item_id: collectionItem.id,
          trade_available_at: now,
        })
        .eq("id", persistentItemId)
        .is("draft_inventory_item_id", null)
        .is("trade_collection_item_id", null)
        .select("id,trade_collection_item_id")
        .maybeSingle();

      if (linkError) {
        await supabase
          .from("account_collection_items")
          .update({
            is_active: false,
            notes:
              "Archived automatically because the InstaComp row could not be linked to trade.",
          })
          .eq("id", collectionItem.id);

        if (isMissingTradeHandoffSchema(linkError)) {
          throw new InstaCompJobServerError(
            "Apply the InstaComp trade handoff migration before using Available for Trade.",
            503,
            "INSTACOMP_TRADE_SCHEMA_MISSING",
          );
        }

        throwInstaCompDatabaseError(linkError);
      }

      if (!linkedItem) {
        await supabase
          .from("account_collection_items")
          .update({
            is_active: false,
            notes:
              "Archived automatically because this InstaComp row was already assigned to sell or trade.",
          })
          .eq("id", collectionItem.id);

        throw new InstaCompJobServerError(
          "This InstaComp row was already assigned to sell or trade.",
          409,
          "INSTACOMP_TRADE_ROW_ALREADY_ASSIGNED",
        );
      }
    }

    return Response.json({
      success: true,
      alreadyExisted: false,
      collectionItemId: collectionItem.id,
      title: collectionItem.title,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
