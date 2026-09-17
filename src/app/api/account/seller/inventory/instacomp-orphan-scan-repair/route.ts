import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
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

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isOwner) {
      return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
    }

    const body = record(await request.json().catch(() => ({})));
    const apply = body.apply === true;
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,card_uuid,status,metadata,created_at,updated_at")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .eq("status", "draft")
      .contains("metadata", {
        instacomp: { source: "kingmaker_exact_scan_intake_v2" },
      })
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw error;

    const scannerRows = data || [];
    const itemIds = scannerRows.map((row) => String(row.id));
    const rowsWithImages = new Set<string>();
    for (let index = 0; index < itemIds.length; index += 100) {
      const ids = itemIds.slice(index, index + 100);
      if (!ids.length) continue;
      const { data: imageRows, error: imageError } = await supabase
        .from("inventory_images")
        .select("inventory_item_id")
        .in("inventory_item_id", ids);
      if (imageError) throw imageError;
      for (const image of imageRows || []) {
        rowsWithImages.add(String(image.inventory_item_id));
      }
    }

    const candidates = scannerRows.filter((row) => {
      const metadata = record(row.metadata);
      const instacomp = record(metadata.instacomp);
      const hash = text(instacomp.imagePairSha256);
      return Boolean(
        hash &&
          !row.legacy_product_id &&
          !row.card_uuid &&
          instacomp.identityComplete !== true &&
          !rowsWithImages.has(String(row.id)),
      );
    });

    const groups = new Map<string, typeof candidates>();
    for (const row of candidates) {
      const hash = text(record(record(row.metadata).instacomp).imagePairSha256)!;
      const current = groups.get(hash) || [];
      current.push(row);
      groups.set(hash, current);
    }

    const duplicateGroups = Array.from(groups.entries())
      .filter(([, rows]) => rows.length > 1)
      .map(([hash, rows]) => ({
        hash,
        keeperId: String(rows[0].id),
        archiveIds: rows.slice(1).map((row) => String(row.id)),
        copies: rows.length,
      }));
    const duplicateArchiveIds = duplicateGroups.flatMap((group) => group.archiveIds);
    const archiveAllOrphans = body.archiveAllOrphans === true;
    const confirmCount = Number(body.confirmCount);
    const archiveIds = archiveAllOrphans
      ? candidates.map((row) => String(row.id))
      : duplicateArchiveIds;
    let archivedCount = 0;

    if (apply && archiveAllOrphans && confirmCount !== candidates.length) {
      return NextResponse.json(
        {
          success: false,
          error: `Orphan count changed. Expected ${confirmCount || 0}, found ${candidates.length}. Nothing was archived.`,
          orphanCandidates: candidates.length,
        },
        { status: 409 },
      );
    }

    if (apply && archiveIds.length) {
      const { data: archived, error: archiveError } = await supabase
        .from("inventory_items")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id)
        .eq("status", "draft")
        .is("legacy_product_id", null)
        .is("card_uuid", null)
        .contains("metadata", {
          instacomp: { source: "kingmaker_exact_scan_intake_v2" },
        })
        .in("id", archiveIds)
        .select("id");
      if (archiveError) throw archiveError;
      archivedCount = archived?.length || 0;
    }

    return NextResponse.json({
      success: true,
      apply,
      archiveScope: archiveAllOrphans ? "all_orphan_candidates" : "duplicate_orphans_only",
      scannerDrafts: scannerRows.length,
      orphanCandidates: candidates.length,
      uniqueScanPairs: groups.size,
      duplicateGroups: duplicateGroups.length,
      duplicateRows: duplicateArchiveIds.length,
      singletonRows: Array.from(groups.values()).filter((rows) => rows.length === 1).length,
      archiveTargetCount: archiveIds.length,
      archivedCount,
      groups: duplicateGroups.slice(0, 100).map((group) => ({
        hashPrefix: group.hash.slice(0, 16),
        keeperId: group.keeperId,
        archiveIds: group.archiveIds,
        copies: group.copies,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not repair scanner orphans." },
      { status: 500 },
    );
  }
}
