import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
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

function printRun(value: unknown) {
  const raw = clean(value, 30);
  if (!raw) return null;
  const match = raw.match(/(?:\d+\s*)?\/\s*(\d{1,6})\b/);
  if (match) return `/${Number(match[1])}`;
  const digits = raw.match(/^\/?(\d{1,6})$/);
  return digits ? `/${Number(digits[1])}` : null;
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = clean(body.inventoryItemId, 100);
    const title = clean(body.title, 300);
    const parallel = clean(body.parallel, 120);
    const normalizedPrintRun = printRun(body.printRun);
    if (!inventoryItemId || !title) {
      return NextResponse.json({ error: "Card and title are required." }, { status: 400 });
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
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await query.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Pending card was not found." }, { status: 404 });

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const ai = record(instaComp.ai);
    const collectibleAsset = record(metadata.collectible_asset);
    const sellerReview = record(metadata.seller_review);
    const editedAt = new Date().toISOString();

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
        pricingStatus: "manual_identity_saved_pricing_pending",
        pricingReason: "Seller identity is locked. Pricing may run without replacing the seller correction.",
        suggestedPrice: null,
        lastError: null,
        lastErrorCode: null,
        ai: {
          ...ai,
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
      published: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not edit pending card." },
      { status: 500 },
    );
  }
}
