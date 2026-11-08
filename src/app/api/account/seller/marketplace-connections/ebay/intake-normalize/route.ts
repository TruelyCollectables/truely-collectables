import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { classifyCollectibleCategory } from "../../../../../../../lib/collectible-category-policy";
import { stageLegacySellerAutographIntake } from "../../../../../../../lib/seller-legacy-autograph-intake";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((entry) => String(entry || "").trim())
            .filter(Boolean),
        ),
      )
    : [];
}

function isBlockedJunk(
  title: string,
  category: string,
  aspects: Record<string, unknown>,
) {
  const text = normalized(`${title} ${category} ${JSON.stringify(aspects)}`);
  return /\b(pants|jeans|trousers|shorts|shoes|sneakers|boots|watch|watches|air intake|fuel sensor|oxygen sensor|throttle body|automotive|auto part|car part|engine part|brake part|suspension part)\b/.test(
    text,
  );
}

function hasAutographSignal(
  title: string,
  metadata: Record<string, unknown>,
) {
  const authenticity = recordValue(metadata.authenticity);
  const authenticityStatus = normalized(authenticity.status);
  const text = normalized(title);

  return (
    /\b(signed|autograph|autographed|inscribed|coa|psa dna|beckett|jsa)\b/.test(
      text,
    ) ||
    (authenticityStatus &&
      authenticityStatus !== "none" &&
      authenticityStatus !== "not disclosed")
  );
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: connection, error: connectionError } = await supabase
      .from("seller_marketplace_connections")
      .select("id,provider_metadata")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .single();

    if (connectionError || !connection) {
      return Response.json(
        { error: "Connect the seller eBay account before running intake." },
        { status: 409 },
      );
    }

    const legacyTrading = await stageLegacySellerAutographIntake({
      supabase,
      accountId: account.id,
      storeId,
      connectionId: connection.id,
    });

    const providerMetadata = recordValue(connection.provider_metadata);
    const denied = new Set(
      stringList(providerMetadata.seller_intake_denied_ids),
    );
    const approved = new Set(
      stringList(providerMetadata.seller_intake_approved_ids),
    );

    const { data: rows, error: rowsError } = await supabase
      .from("seller_marketplace_staged_items")
      .select("id,source_item_id,sku,title,stage_status,metadata,updated_at")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .neq("stage_status", "mapped")
      .limit(1000);

    if (rowsError) throw rowsError;

    let reviewCount = 0;
    let blockedCount = 0;
    let approvedCount = 0;
    let tradingCardCount = 0;
    let normalCount = 0;
    const now = new Date().toISOString();

    for (const row of rows || []) {
      const metadata = recordValue(row.metadata);
      const sourceId =
        textValue(row.source_item_id) || textValue(metadata.source_listing_id);
      if (!sourceId) continue;

      const originalCategory =
        normalized(metadata.category_hint).replaceAll(" ", "_") ||
        "other_collectable";
      const aspects = recordValue(metadata.source_aspects);
      const title = String(row.title || "Untitled");
      const categoryDecision = classifyCollectibleCategory({
        title,
        category: originalCategory,
        aspects,
        metadata,
      });
      const category = categoryDecision.category;
      let nextStatus = String(row.stage_status || "staged");
      let intakeLane = "normal_collectable";
      let intakeReason = "normal collectible staging";

      if (denied.has(sourceId)) {
        nextStatus = "skipped";
        intakeLane = "seller_denied";
        intakeReason = "seller denied forever";
        blockedCount += 1;
      } else if (isBlockedJunk(title, category, aspects)) {
        nextStatus = "skipped";
        intakeLane = "blocked_junk";
        intakeReason = "blocked pants, shoes, watches, or automotive parts";
        blockedCount += 1;
      } else if (approved.has(sourceId)) {
        nextStatus = "staged";
        intakeLane = "seller_approved";
        intakeReason = "seller approved for private draft promotion";
        approvedCount += 1;
      } else if (categoryDecision.isTradingCard) {
        nextStatus = "staged";
        intakeLane = "trading_card";
        intakeReason =
          "trading card retained in card flow; autograph, patch, relic, jersey-swatch, and memorabilia words are card features";
        tradingCardCount += 1;
      } else if (
        categoryDecision.isPhysicalMemorabilia ||
        hasAutographSignal(title, metadata)
      ) {
        nextStatus = "needs_review";
        intakeLane = "autograph_review";
        intakeReason =
          "physical autograph or memorabilia collectible requires seller approval";
        reviewCount += 1;
      } else {
        normalCount += 1;
      }

      const nextMetadata = {
        ...metadata,
        category_hint: category,
        category_confidence: categoryDecision.confidence,
        category_policy: {
          schema: "truely.collectibleCategoryPolicy.v1",
          category,
          is_trading_card: categoryDecision.isTradingCard,
          is_physical_memorabilia: categoryDecision.isPhysicalMemorabilia,
          reasons: categoryDecision.reasons,
          previous_category: originalCategory,
          evaluated_at: now,
        },
        intake_lane: intakeLane,
        intake_reason: intakeReason,
        intake_normalized_at: now,
      };

      const { error: updateError } = await supabase
        .from("seller_marketplace_staged_items")
        .update({
          stage_status: nextStatus,
          metadata: nextMetadata,
          updated_at: now,
        })
        .eq("id", row.id)
        .eq("account_id", account.id)
        .eq("store_id", storeId);

      if (updateError) throw updateError;
    }

    return Response.json({
      success: true,
      scannedCount: rows?.length || 0,
      reviewCount,
      blockedCount,
      approvedCount,
      tradingCardCount,
      normalCount,
      legacyTrading,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not normalize seller eBay intake." },
      { status: 500 },
    );
  }
}
