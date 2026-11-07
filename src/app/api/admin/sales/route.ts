import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "../../../../lib/admin-request-auth";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { classifyStorefrontItem } from "../../../../lib/storefront-taxonomy";
import {
  normalizeStoreSaleScope,
  type StoreSaleScopeType,
} from "../../../../lib/store-sales";

export const dynamic = "force-dynamic";

async function adminOnly(request: Request) {
  if (await hasValidAdminRequest(request)) return null;
  return NextResponse.json({ error: "Log in through the TCOS admin first." }, { status: 401 });
}

function scopeType(value: unknown): StoreSaleScopeType | null {
  return value === "all" || value === "filter" || value === "products" ? value : null;
}

function validCampaignInput(body: Record<string, unknown>) {
  const name = String(body.name || "").trim().slice(0, 80);
  const percentOff = Math.round(Number(body.percentOff) * 100) / 100;
  const type = scopeType(body.scopeType);
  const scope = normalizeStoreSaleScope(body.scope);
  const startsAt = body.startsAt ? new Date(String(body.startsAt)) : new Date();
  const endsAt = body.endsAt ? new Date(String(body.endsAt)) : null;
  if (name.length < 2) throw new Error("Sale name needs at least 2 characters.");
  if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 90) {
    throw new Error("Discount must be between 1% and 90%.");
  }
  if (!type) throw new Error("Choose a valid sale scope.");
  if (!Number.isFinite(startsAt.getTime())) throw new Error("Start date is invalid.");
  if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt)) {
    throw new Error("End date must be after the start date.");
  }
  if (type === "products" && !scope.productIds?.length) {
    throw new Error("Select at least one inventory item.");
  }
  if (
    type === "filter" &&
    !scope.search &&
    !scope.sections?.length &&
    !scope.players?.length &&
    scope.minPrice == null &&
    scope.maxPrice == null
  ) {
    throw new Error("Add at least one filter, or choose Entire store.");
  }
  if (scope.minPrice != null && scope.maxPrice != null && scope.minPrice > scope.maxPrice) {
    throw new Error("Minimum price cannot exceed maximum price.");
  }
  return { name, percentOff, type, scope, startsAt, endsAt };
}

export async function GET(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [campaignResult, inventoryResult] = await Promise.all([
    supabase
      .from("store_sales_campaigns")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("products")
      .select("id,title,player,sport,price,quantity,image_url")
      .eq("store_id", storeId)
      .gt("price", 0)
      .gt("quantity", 0)
      .is("archived_at", null)
      .order("id", { ascending: false })
      .range(0, 4999),
  ]);
  if (campaignResult.error) return NextResponse.json({ error: campaignResult.error.message }, { status: 500 });
  if (inventoryResult.error) return NextResponse.json({ error: inventoryResult.error.message }, { status: 500 });
  const now = Date.now();
  const campaigns = (campaignResult.data || []).map((campaign: any) => {
    const starts = new Date(campaign.starts_at).getTime();
    const ends = campaign.ends_at ? new Date(campaign.ends_at).getTime() : null;
    const status = !campaign.active
      ? "inactive"
      : starts > now
        ? "scheduled"
        : ends !== null && ends <= now
          ? "ended"
          : "live";
    return { ...campaign, status };
  });
  const inventory = (inventoryResult.data || []).map((row: any) => {
    const classification = classifyStorefrontItem({
      title: String(row.title || ""),
      description: null,
      rawSport: row.sport || null,
      primaryCategory: null,
      metadata: null,
    });
    return {
      id: Number(row.id),
      title: String(row.title || "Untitled"),
      player: row.player || null,
      section: classification.section,
      price: Number(row.price || 0),
      quantity: Number(row.quantity || 0),
      imageUrl: row.image_url || null,
    };
  });
  return NextResponse.json({ campaigns, inventory });
}

export async function POST(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = validCampaignInput(body);
    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("store_sales_campaigns")
      .insert({
        store_id: getActiveStoreId(),
        name: input.name,
        percent_off: input.percentOff,
        active: body.active !== false,
        starts_at: input.startsAt.toISOString(),
        ends_at: input.endsAt?.toISOString() || null,
        scope_type: input.type,
        scope: input.scope,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ campaign: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sale could not be created." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    const action = String(body.action || "");
    if (!id) return NextResponse.json({ error: "Sale ID is required." }, { status: 400 });
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    if (action === "delete") {
      const { error } = await supabase.from("store_sales_campaigns").delete().eq("id", id).eq("store_id", storeId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action !== "set-active") {
      return NextResponse.json({ error: "Unknown sale action." }, { status: 400 });
    }
    const { error } = await supabase
      .from("store_sales_campaigns")
      .update({ active: body.active === true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("store_id", storeId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sale could not be updated." }, { status: 400 });
  }
}
