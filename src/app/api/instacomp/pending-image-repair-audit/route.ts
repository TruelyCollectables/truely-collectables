import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  isValidInstaCompServiceRequest,
  requireInstaCompJobSupabase,
} from "../../../../lib/instacomp-job-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireServiceRequest(request: NextRequest) {
  requireInstaCompJobSupabase();
  if (!isValidInstaCompServiceRequest(request)) {
    throw new InstaCompJobServerError(
      "Valid InstaComp service authentication is required.",
      401,
      "INSTACOMP_REPAIR_AUDIT_UNAUTHORIZED",
    );
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Pending image audit failed.",
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  try {
    requireServiceRequest(request);
    const supabase = requireInstaCompJobSupabase();
    const storeId = getActiveStoreId();

    const { data: drafts, error: draftError } = await supabase
      .from("inventory_items")
      .select("id,title,metadata,created_at")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true });
    if (draftError) throw draftError;

    const scanDrafts = (drafts || [])
      .map((row: any) => {
        const metadata = recordValue(row.metadata);
        const instaComp = recordValue(metadata.instacomp);
        return {
          inventoryItemId: String(row.id),
          title: row.title || "Untitled item",
          scanId: textValue(instaComp.scanId),
          metadataHasBackImage: instaComp.hasBackImage === true,
          createdAt: row.created_at || null,
        };
      })
      .filter((row) => Boolean(row.scanId));

    const itemIds = scanDrafts.map((row) => row.inventoryItemId);
    const { data: imageRows, error: imageError } =
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

    const imagesByItem = new Map<string, any[]>();
    for (const row of imageRows || []) {
      const itemId = String((row as any).inventory_item_id || "");
      if (!itemId) continue;
      const current = imagesByItem.get(itemId) || [];
      current.push(row);
      imagesByItem.set(itemId, current);
    }

    const items = scanDrafts.map((draft) => {
      const images = imagesByItem.get(draft.inventoryItemId) || [];
      const front =
        images.find((row) => row.is_primary === true) ||
        images.find((row) => Number(row.sort_order) === 0) ||
        images[0] ||
        null;
      const back =
        images.find((row) => /\bback\b/i.test(String(row.alt_text || ""))) ||
        images.find(
          (row) =>
            row.is_primary !== true && Number(row.sort_order) > 0,
        ) ||
        images.find((row) => row !== front) ||
        null;
      const frontImageUrl = textValue(front?.image_url);
      const backImageUrl = textValue(back?.image_url);
      const actualHasBackImage = Boolean(backImageUrl);

      return {
        ...draft,
        imageCount: images.length,
        frontImageUrl,
        backImageUrl,
        actualHasBackImage,
        status:
          actualHasBackImage && draft.metadataHasBackImage
            ? "complete"
            : actualHasBackImage
              ? "stored_back_metadata_stale"
              : "missing_stored_back",
      };
    });

    const candidates = items.filter((item) => !item.actualHasBackImage);
    const staleMetadata = items.filter(
      (item) => item.actualHasBackImage && !item.metadataHasBackImage,
    );

    return NextResponse.json(
      {
        ok: true,
        items,
        candidates,
        summary: {
          pendingScanDrafts: items.length,
          complete: items.length - candidates.length,
          missingStoredBack: candidates.length,
          storedBackMetadataStale: staleMetadata.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
