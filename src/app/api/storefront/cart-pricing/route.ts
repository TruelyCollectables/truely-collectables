import { NextResponse } from "next/server";
import { createServerInventoryEngine } from "../../../../lib/server-inventory-engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids)
      ? Array.from(
          new Set<number>(
            body.ids
              .map((value: unknown) => Number(value))
              .filter((id: number) => Number.isInteger(id) && id > 0),
          ),
        ).slice(0, 100)
      : [];
    if (!ids.length) return NextResponse.json({ items: [] });
    const engine = createServerInventoryEngine();
    const items = await engine.getByLegacyProductIds(ids);
    return NextResponse.json({
      items: items.map((item) => ({
        id: item.legacyProductId,
        price: Number(item.price),
        quantity: Number(item.quantity),
        available: item.status === "active" && item.quantity > 0 && item.price > 0,
        promotion: item.promotion || null,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cart pricing unavailable." }, { status: 500 });
  }
}
