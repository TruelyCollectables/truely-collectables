import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "../../../../../lib/admin-request-auth";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { classifyStorefrontItem } from "../../../../../lib/storefront-taxonomy";
import {
  normalizeStoreSaleScope,
  resolveStoreSale,
  type StoreSaleCampaign,
  type StoreSaleScopeType,
} from "../../../../../lib/store-sales";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await hasValidAdminRequest(request))) {
    return NextResponse.json({ error: "Log in through the TCOS admin first." }, { status: 401 });
  }
  try {
    const body = await request.json();
    const scopeType = String(body.scopeType || "all") as StoreSaleScopeType;
    if (!(["all", "filter", "products"] as string[]).includes(scopeType)) {
      return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
    }
    const percentOff = Number(body.percentOff);
    if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 90) {
      return NextResponse.json({ error: "Discount must be between 1% and 90%." }, { status: 400 });
    }
    const campaign: StoreSaleCampaign = {
      id: "preview",
      store_id: getActiveStoreId(),
      name: "Preview",
      percent_off: percentOff,
      active: true,
      starts_at: new Date(0).toISOString(),
      ends_at: null,
      scope_type: scopeType,
      scope: normalizeStoreSaleScope(body.scope),
    };
    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("products")
      .select("id,title,player,sport,price,quantity")
      .eq("store_id", getActiveStoreId())
      .gt("price", 0)
      .gt("quantity", 0)
      .is("archived_at", null)
      .range(0, 9999);
    if (error) throw error;
    const matches = (data || []).flatMap((row: any) => {
      const classification = classifyStorefrontItem({
        title: String(row.title || ""),
        description: null,
        rawSport: row.sport || null,
        primaryCategory: null,
        metadata: null,
      });
      const resolved = resolveStoreSale({
        campaigns: [campaign],
        candidate: {
          productId: Number(row.id),
          title: String(row.title || "Untitled"),
          player: row.player || null,
          section: classification.section,
          price: Number(row.price || 0),
        },
        now: new Date(),
      });
      if (!resolved.campaign) return [];
      return [{
        id: Number(row.id),
        title: String(row.title || "Untitled"),
        player: row.player || null,
        section: classification.section,
        quantity: Number(row.quantity || 0),
        originalPrice: resolved.originalPrice,
        salePrice: resolved.price,
      }];
    });
    return NextResponse.json({ affectedCount: matches.length, items: matches.slice(0, 50) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sale preview failed." }, { status: 400 });
  }
}
