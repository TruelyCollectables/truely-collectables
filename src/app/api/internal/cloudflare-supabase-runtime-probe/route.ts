import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMEOUT_MS = 6_000;

type Probe = {
  name: string;
  ok: boolean;
  elapsedMs: number;
  status?: number;
  detail?: string;
};

async function timed(
  name: string,
  work: (signal: AbortSignal) => Promise<{ ok: boolean; status?: number; detail?: string }>,
): Promise<Probe> {
  const started = Date.now();
  try {
    const result = await work(AbortSignal.timeout(TIMEOUT_MS));
    return { name, elapsedMs: Date.now() - started, ...result };
  } catch (error) {
    return {
      name,
      ok: false,
      elapsedMs: Date.now() - started,
      detail: error instanceof Error ? error.name || error.message : "error",
    };
  }
}

function restUrl(base: string) {
  return `${base}/rest/v1/products?select=id&limit=1`;
}

function restHeaders(key: string) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: "application/json",
  };
}

export async function GET() {
  const nativeFetch = globalThis.__TRUELY_CLOUDFLARE_NATIVE_FETCH__;
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (typeof nativeFetch !== "function") {
    return NextResponse.json({
      ok: false,
      runtime: "opennext",
      nativeFetchPresent: false,
      supabaseUrlConfigured: Boolean(base),
      serviceKeyConfigured: Boolean(key),
      reason: "native_fetch_marker_missing",
    });
  }

  if (!base || !key) {
    return NextResponse.json({
      ok: false,
      runtime: "opennext",
      nativeFetchPresent: true,
      supabaseUrlConfigured: Boolean(base),
      serviceKeyConfigured: Boolean(key),
      reason: "supabase_config_missing",
    });
  }

  const [rawNative, rawGlobal, supabaseJs] = await Promise.all([
    timed("captured_native_rest", async (signal) => {
      const response = await nativeFetch(restUrl(base), {
        headers: restHeaders(key),
        cache: "no-store",
        signal,
      });
      await response.body?.cancel().catch(() => {});
      return { ok: response.ok, status: response.status };
    }),
    timed("current_global_rest", async (signal) => {
      const response = await globalThis.fetch(restUrl(base), {
        headers: restHeaders(key),
        cache: "no-store",
        signal,
      });
      await response.body?.cancel().catch(() => {});
      return { ok: response.ok, status: response.status };
    }),
    timed("supabase_js", async (signal) => {
      const client = createSupabaseServerClient({ admin: true });
      const { error } = await client
        .from("products")
        .select("id")
        .limit(1)
        .abortSignal(signal);
      return { ok: !error, detail: error ? "query_error" : undefined };
    }),
  ]);

  return NextResponse.json({
    ok: rawNative.ok && rawGlobal.ok && supabaseJs.ok,
    runtime: "opennext",
    nativeFetchPresent: true,
    globalFetchIsNative: globalThis.fetch === nativeFetch,
    timeoutMs: TIMEOUT_MS,
    probes: [rawNative, rawGlobal, supabaseJs],
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
