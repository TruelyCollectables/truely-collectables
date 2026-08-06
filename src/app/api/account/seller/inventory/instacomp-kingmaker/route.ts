import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_WORKBENCH_CARDS = 100;

type JsonRecord = Record<string, unknown>;
type StoredImage = {
  inventory_item_id: string;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringList(value: unknown, limit = 30) {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, 240))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

function imagePair(rows: StoredImage[]) {
  const images = rows
    .map((row) => ({
      url: text(row.image_url, 2_000),
      alt: text(row.alt_text, 300),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter(
      (
        row,
      ): row is {
        url: string;
        alt: string | null;
        order: number;
        primary: boolean;
      } => Boolean(row.url),
    )
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      return left.order - right.order;
    });

  const front =
    images.find((image) => /\bfront\b/i.test(image.alt || "")) ||
    images.find((image) => image.primary) ||
    images[0] ||
    null;
  const back =
    images.find(
      (image) =>
        /\bback\b/i.test(image.alt || "") && image.url !== front?.url,
    ) ||
    images.find((image) => !image.primary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;

  return {
    frontImageUrl: front?.url || null,
    backImageUrl: back?.url || null,
    frontFound: Boolean(front?.url),
    backFound: Boolean(back?.url),
    distinctUrls: Boolean(front?.url && back?.url && front.url !== back.url),
    storedImageCount: images.length,
    readyForAutomaticScan: Boolean(
      front?.url && back?.url && front.url !== back.url,
    ),
  };
}

async function registryCoverage(
  supabase: ReturnType<typeof createSupabaseServerClient>,
) {
  const [versions, cards] = await Promise.allSettled([
    supabase
      .from("checklist_versions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("status", "live"),
    supabase
      .from("checklist_cards")
      .select("id,version:checklist_versions!inner(id,is_active,status)", {
        count: "exact",
        head: true,
      })
      .eq("version.is_active", true)
      .eq("version.status", "live"),
  ]);

  const versionResult =
    versions.status === "fulfilled" ? versions.value : null;
  const cardResult = cards.status === "fulfilled" ? cards.value : null;
  const available = !versionResult?.error && !cardResult?.error;

  return {
    available,
    activeLiveVersions: available ? Number(versionResult?.count || 0) : 0,
    activeLiveCards: available ? Number(cardResult?.count || 0) : 0,
    error: available
      ? null
      : text(
          versionResult?.error?.message ||
            cardResult?.error?.message ||
            "Checklist coverage could not be read.",
          500,
        ),
  };
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
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
      .select("id,seller_account_id,status,title,sku,metadata,updated_at")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(MAX_WORKBENCH_CARDS);
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    const [{ data: rows, error }, coverage] = await Promise.all([
      query,
      registryCoverage(supabase),
    ]);
    if (error) throw error;

    const itemIds = (rows || []).map((row: any) => String(row.id));
    const { data: storedImages, error: imageError } =
      itemIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("inventory_images")
            .select(
              "inventory_item_id,image_url,alt_text,sort_order,is_primary",
            )
            .in("inventory_item_id", itemIds)
            .order("sort_order", { ascending: true });
    if (imageError) throw imageError;

    const imagesByItem = new Map<string, StoredImage[]>();
    for (const row of (storedImages || []) as StoredImage[]) {
      const id = String(row.inventory_item_id);
      const current = imagesByItem.get(id) || [];
      current.push(row);
      imagesByItem.set(id, current);
    }

    const items = (rows || []).map((row: any) => {
      const metadata = record(row.metadata);
      const instaComp = record(metadata.instacomp);
      const ai = record(instaComp.ai);
      const asset = record(metadata.collectible_asset);
      const orientation = record(instaComp.imageOrientation);
      const checklistDecision = record(instaComp.checklistDecision);
      const parallelDecision = record(instaComp.parallelDecision);
      const identityComplete = instaComp.identityComplete === true;
      const parallel =
        text(
          ai.checklistParallel ||
            ai.parallelName ||
            ai.parallel ||
            asset.parallel_name,
          160,
        ) || (identityComplete ? "Base" : null);

      return {
        inventoryItemId: String(row.id),
        title: text(row.title, 240) || "Untitled card",
        sku: text(row.sku, 120),
        updatedAt: row.updated_at || null,
        imageAudit: imagePair(
          imagesByItem.get(String(row.id)) || [],
        ),
        identity: {
          identityComplete,
          locked: instaComp.manualIdentityLocked === true,
          humanVerified: instaComp.humanVerified === true,
          trustedForIdentity: instaComp.trustedForIdentity === true,
          savedAt: text(instaComp.manualIdentitySavedAt, 80),
          source: text(instaComp.identitySource, 160),
          player: text(ai.player || ai.playerName, 180),
          year: text(ai.year, 20),
          manufacturer: text(ai.manufacturer || ai.brand, 120),
          setName: text(ai.setName || ai.set, 200),
          cardNumber: text(ai.cardNumber || ai.card_number, 80),
          parallel,
          variation: text(ai.variation, 160),
          serialNumber: text(ai.serialNumber || ai.printRun, 120),
          sport: text(ai.sport, 120),
          team: text(ai.team, 180),
          isAuto: ai.isAuto === true,
          isRelic: ai.isRelic === true,
        },
        orientation: {
          persisted: instaComp.imageOrientationPersisted === true,
          status: text(orientation.status, 80),
          model: text(orientation.model, 120),
          frontRotation: numberOrZero(orientation.frontRotation),
          backRotation: numberOrZero(orientation.backRotation),
          frontConfidence: numberOrZero(orientation.frontConfidence),
          backConfidence: numberOrZero(orientation.backConfidence),
          frontEvidenceText: stringList(orientation.frontEvidenceText, 12),
          backEvidenceText: stringList(orientation.backEvidenceText, 12),
          reason: text(orientation.reason, 1_000),
        },
        checklist: {
          status:
            text(checklistDecision.status, 80) ||
            text(record(instaComp.checklistIdentity).status, 80),
          candidateCount: numberOrZero(
            checklistDecision.candidateCount ||
              record(instaComp.checklistIdentity).candidateCount,
          ),
          reasons: stringList(checklistDecision.reasons, 30),
          candidateIdentityIds: stringList(
            checklistDecision.candidateIdentityIds,
            100,
          ),
          parallelStatus: text(parallelDecision.status, 80),
          selectedParallel: text(parallelDecision.selectedParallel, 160),
          parallelConfidence: numberOrZero(parallelDecision.confidence),
          parallelEvidence: text(parallelDecision.evidence, 1_000),
          candidateParallels: stringList(
            parallelDecision.candidateParallels,
            100,
          ),
        },
        scan: {
          scanId: text(instaComp.scanId, 100),
          lastStatus: text(instaComp.lastStatus, 80),
          lastStage: text(instaComp.lastStage, 80),
          lastError: text(instaComp.lastError, 1_000),
          lastErrorCode: text(instaComp.lastErrorCode, 120),
          pricingStatus: text(instaComp.pricingStatus, 120),
          pricingReason: text(instaComp.pricingReason, 1_000),
          learningPromotion: record(instaComp.learningPromotion),
        },
      };
    });

    return NextResponse.json(
      {
        success: true,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        limit: MAX_WORKBENCH_CARDS,
        coverage,
        items,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "KINGMAKER workbench failed to load.",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
