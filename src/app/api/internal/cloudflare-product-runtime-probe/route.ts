import { NextResponse } from "next/server";
import { createServerInventoryEngine } from "../../../../lib/server-inventory-engine";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProbeResult = {
  name: string;
  ok: boolean;
  elapsedMs: number;
  status?: number;
  timedOut?: boolean;
  detail?: string;
};

async function timed(
  name: string,
  work: (signal: AbortSignal) => Promise<{ ok: boolean; status?: number; detail?: string }>,
  timeoutMs = 8_000,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const result = await work(AbortSignal.timeout(timeoutMs));
    return { name, elapsedMs: Date.now() - started, ...result };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const label = error instanceof Error ? error.name || error.message : "error";
    return {
      name,
      ok: false,
      elapsedMs,
      timedOut: elapsedMs >= timeoutMs - 100,
      detail: String(label).slice(0, 80),
    };
  }
}

export async function GET() {
  const nativeFetch = globalThis.__TRUELY_CLOUDFLARE_NATIVE_FETCH__;
  if (!nativeFetch) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const storeId = getActiveStoreId();
  const productId = 1991;
  const results: ProbeResult[] = [];

  results.push(
    await timed("native_rest_product", async (signal) => {
      const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
      const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
      if (!base || !key) return { ok: false, detail: "missing_supabase_config" };
      const url = new URL(`${base}/rest/v1/products`);
      url.searchParams.set("select", "id");
      url.searchParams.set("store_id", `eq.${storeId}`);
      url.searchParams.set("id", `eq.${productId}`);
      url.searchParams.set("limit", "1");
      const response = await nativeFetch(url, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal,
      });
      await response.body?.cancel().catch(() => {});
      return { ok: response.ok, status: response.status };
    }),
  );

  results.push(
    await timed("supabase_js_product", async (signal) => {
      const supabase = createSupabaseServerClient({ admin: true });
      const { data, error } = await supabase
        .from("products")
        .select("id")
        .eq("store_id", storeId)
        .eq("id", productId)
        .abortSignal(signal)
        .maybeSingle();
      return { ok: !error && Boolean(data), detail: error ? "query_error" : undefined };
    }),
  );

  results.push(
    await timed("supabase_js_inventory_item", async (signal) => {
      const supabase = createSupabaseServerClient({ admin: true });
      const { error } = await supabase
        .from("inventory_items")
        .select("id")
        .eq("store_id", storeId)
        .eq("legacy_product_id", productId)
        .order("created_at", { ascending: true })
        .limit(1)
        .abortSignal(signal);
      return { ok: !error, detail: error ? "query_error" : undefined };
    }),
  );

  results.push(
    await timed(
      "inventory_engine_product",
      async () => {
        const item = await createServerInventoryEngine().getByLegacyProductId(productId);
        return { ok: Boolean(item), detail: item ? undefined : "not_public_or_missing" };
      },
      12_000,
    ),
  );

  const ok = results.every((result) => result.ok);
  return NextResponse.json(
    { ok, runtime: "cloudflare", results },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}
