import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { PLATFORM_DOMAIN } from "../../../../../lib/legal";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type CollectorItemKind = "collection_item" | "wish_list_item";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanNullableText(value: unknown) {
  const text = cleanText(value);
  return text.length > 0 ? text : null;
}

function cleanMoney(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;

  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanYear(value: unknown) {
  return cleanText(value).replace(/[^0-9]/g, "").slice(0, 4) || null;
}

function cleanVisibility(value: unknown) {
  const text = cleanNullableText(value) || "friends";

  return ["private", "friends", "followers", "community", "public"].includes(text)
    ? text
    : "friends";
}

function siteBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    `https://${PLATFORM_DOMAIN}`
  ).replace(/\/$/, "");
}

function createShareSlug() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  return random.replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase();
}

function defaultWishExpiryIso(wishType: string) {
  if (wishType !== "want_ad") return null;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  return expiresAt.toISOString();
}

function isMissingCollectorTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_collection_items") ||
    message.includes("account_wish_list_items") ||
    message.includes("account_brag_posts")
  );
}

function collectorUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Collector dashboard is not available until the collection/wish list migration is applied.",
    },
    { status: 503 },
  );
}

function collectorItemsHeaders(params: {
  collectionItemCount: number;
  wishListItemCount: number;
}) {
  return {
    "X-TCOS-Collector-Items": String(params.collectionItemCount),
    "X-TCOS-Collector-Wish-List": String(params.wishListItemCount),
  };
}

function collectorMutationHeaders(params: {
  kind: CollectorItemKind;
  action: "created" | "archived" | "canceled";
  itemId: string;
}) {
  return {
    "X-TCOS-Collector-Item-Kind": params.kind,
    "X-TCOS-Collector-Mutation": params.action,
    "X-TCOS-Collector-Item-Id": params.itemId,
  };
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const [collectionResult, wishListResult] = await Promise.all([
      supabase
        .from("account_collection_items")
        .select(
          "id,title,category,item_type,image_url,acquisition_source,acquisition_price,estimated_value,value_confidence,grade_company,grade_value,certification_number,condition,ownership_status,visibility,is_favorite,notes,metadata,created_at",
        )
        .eq("store_id", storeId)
        .eq("account_id", account.id)
        .eq("is_active", true)
        .order("is_favorite", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("account_wish_list_items")
        .select(
          "id,wish_type,title,category,item_type,search_query,player_name,team_name,brand,set_name,release_year,card_number,variant,desired_condition,desired_grade,budget_min,budget_max,priority,status,visibility,expires_at,auto_renew,notes,created_at",
        )
        .eq("store_id", storeId)
        .eq("account_id", account.id)
        .in("status", ["active", "matched", "renewed"])
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (collectionResult.error || wishListResult.error) {
      const error = collectionResult.error || wishListResult.error;
      if (error && isMissingCollectorTables(error)) {
        return collectorUnavailableResponse();
      }

      throw error;
    }

    const collectionItems = collectionResult.data ?? [];
    const wishListItems = wishListResult.data ?? [];

    return NextResponse.json(
      {
        success: true,
        collectionItems,
        wishListItems,
      },
      {
        headers: collectorItemsHeaders({
          collectionItemCount: collectionItems.length,
          wishListItemCount: wishListItems.length,
        }),
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load collector dashboard" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const kind = cleanText(body.kind) as CollectorItemKind;
    const title = cleanText(body.title);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (kind === "collection_item") {
      const acquisitionPrice = cleanMoney(body.acquisitionPrice);
      const acquisitionSource =
        cleanNullableText(body.acquisitionSource) ||
        (cleanNullableText(body.cardShowName) ? "card_show" : null);
      const cardShowName = cleanNullableText(body.cardShowName);
      const sharePurchaseAsComp = body.sharePurchaseAsComp === true;
      const createBragPost = body.createBragPost === true;
      const bragVisibility = cleanVisibility(body.bragVisibility);
      const metadata = {
        collector_comp: {
          opted_in: sharePurchaseAsComp,
          viable_comp: sharePurchaseAsComp && acquisitionPrice !== null,
          source: acquisitionSource,
          price: acquisitionPrice,
          card_show_name: cardShowName,
          confidence: sharePurchaseAsComp
            ? "collector_reported_purchase"
            : "private_collection_record",
          submitted_at: new Date().toISOString(),
        },
      };
      const { data, error } = await supabase
        .from("account_collection_items")
        .insert({
          account_id: account.id,
          store_id: storeId,
          title,
          category: cleanNullableText(body.category),
          item_type: cleanNullableText(body.itemType) || "collectable",
          image_url: cleanNullableText(body.imageUrl),
          acquisition_source: acquisitionSource,
          acquisition_price: acquisitionPrice,
          estimated_value: cleanMoney(body.estimatedValue),
          value_confidence:
            sharePurchaseAsComp && acquisitionPrice !== null
              ? "collector_reported_comp"
              : null,
          grade_company: cleanNullableText(body.gradeCompany),
          grade_value: cleanNullableText(body.gradeValue),
          certification_number: cleanNullableText(body.certificationNumber),
          condition: cleanNullableText(body.condition),
          ownership_status: cleanNullableText(body.ownershipStatus) || "owned",
          visibility: cleanNullableText(body.visibility) || "private",
          is_favorite: body.isFavorite === true,
          notes: cleanNullableText(body.notes),
          metadata,
        })
        .select("*")
        .single();

      if (error) {
        if (isMissingCollectorTables(error)) return collectorUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      let bragPost = null;

      if (createBragPost) {
        const shareSlug = createShareSlug();
        const shareUrl = `${siteBaseUrl()}/brag/${shareSlug}`;
        const bragBody =
          cleanNullableText(body.bragBody) ||
          [
            cardShowName ? `Picked up at ${cardShowName}.` : null,
            sharePurchaseAsComp && acquisitionPrice !== null
              ? `Reported pickup price: $${acquisitionPrice.toFixed(2)}.`
              : null,
            cleanNullableText(body.notes),
          ]
            .filter(Boolean)
            .join(" ");
        const { data: bragData, error: bragError } = await supabase
          .from("account_brag_posts")
          .insert({
            store_id: storeId,
            account_id: account.id,
            collection_item_id: data.id,
            title: `Card show pickup: ${title}`,
            body: bragBody || null,
            image_url: data.image_url || null,
            share_slug: shareSlug,
            share_url: shareUrl,
            visibility: bragVisibility,
            metadata: {
              source: "collection_pickup",
              collector_comp: metadata.collector_comp,
              share_footer: `Find your next collectable at ${PLATFORM_DOMAIN}`,
            },
          })
          .select("*")
          .single();

        if (bragError) {
          if (!isMissingCollectorTables(bragError)) {
            return NextResponse.json({ error: bragError.message }, { status: 400 });
          }
        } else {
          bragPost = bragData;
        }
      }

      return NextResponse.json(
        { success: true, collectionItem: data, bragPost },
        {
          headers: collectorMutationHeaders({
            kind,
            action: "created",
            itemId: String(data.id),
          }),
        },
      );
    }

    if (kind === "wish_list_item") {
      const wishType = cleanNullableText(body.wishType) || "wish_list";

      const { data, error } = await supabase
        .from("account_wish_list_items")
        .insert({
          account_id: account.id,
          store_id: storeId,
          wish_type: wishType,
          title,
          category: cleanNullableText(body.category),
          item_type: cleanNullableText(body.itemType) || "collectable",
          search_query: cleanNullableText(body.searchQuery) || title,
          player_name: cleanNullableText(body.playerName),
          team_name: cleanNullableText(body.teamName),
          brand: cleanNullableText(body.brand),
          set_name: cleanNullableText(body.setName),
          release_year: cleanYear(body.releaseYear),
          card_number: cleanNullableText(body.cardNumber),
          variant: cleanNullableText(body.variant),
          desired_condition: cleanNullableText(body.desiredCondition),
          desired_grade: cleanNullableText(body.desiredGrade),
          budget_min: cleanMoney(body.budgetMin),
          budget_max: cleanMoney(body.budgetMax),
          priority: cleanNullableText(body.priority) || "normal",
          visibility: cleanNullableText(body.visibility) || "private",
          expires_at: cleanNullableText(body.expiresAt) || defaultWishExpiryIso(wishType),
          auto_renew: body.autoRenew === true,
          notes: cleanNullableText(body.notes),
        })
        .select("*")
        .single();

      if (error) {
        if (isMissingCollectorTables(error)) return collectorUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json(
        { success: true, wishListItem: data },
        {
          headers: collectorMutationHeaders({
            kind,
            action: "created",
            itemId: String(data.id),
          }),
        },
      );
    }

    return NextResponse.json(
      { error: "Unsupported collector item type" },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not save collector item" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const kind = cleanText(body.kind) as CollectorItemKind;
    const id = cleanText(body.id);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (!id) {
      return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
    }

    if (kind === "collection_item") {
      const { error } = await supabase
        .from("account_collection_items")
        .update({
          is_active: false,
          ownership_status: "archived",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("account_id", account.id)
        .eq("store_id", storeId);

      if (error) {
        if (isMissingCollectorTables(error)) return collectorUnavailableResponse();
        throw error;
      }

      return NextResponse.json(
        { success: true },
        {
          headers: collectorMutationHeaders({
            kind,
            action: "archived",
            itemId: id,
          }),
        },
      );
    }

    if (kind === "wish_list_item") {
      const { error } = await supabase
        .from("account_wish_list_items")
        .update({
          status: "canceled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("account_id", account.id)
        .eq("store_id", storeId);

      if (error) {
        if (isMissingCollectorTables(error)) return collectorUnavailableResponse();
        throw error;
      }

      return NextResponse.json(
        { success: true },
        {
          headers: collectorMutationHeaders({
            kind,
            action: "canceled",
            itemId: id,
          }),
        },
      );
    }

    return NextResponse.json(
      { error: "Unsupported collector item type" },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not remove collector item" },
      { status: 500 },
    );
  }
}
