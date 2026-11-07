import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 4_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

async function timed<T>(name: string, task: (signal: AbortSignal) => Promise<T>) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await task(controller.signal);
    return { name, ok: true, elapsedMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      ok: false,
      elapsedMs: Date.now() - started,
      error: message.slice(0, 180),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        configured: {
          url: Boolean(url),
          anonKey: Boolean(anonKey),
          serviceKey: Boolean(serviceKey),
        },
      },
      { status: 500 },
    );
  }

  const rawAnon = await timed("raw-anon-rest", async (signal) => {
    const response = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/products?select=id&limit=1`,
      {
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal,
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.text();
  });

  const anonClient = await timed("supabase-js-anon", async (signal) => {
    const client = createSupabaseServerClient();
    const { error } = await client
      .from("products")
      .select("id")
      .limit(1)
      .abortSignal(signal);
    if (error) throw error;
  });

  const adminClient = await timed("supabase-js-service", async (signal) => {
    const client = createSupabaseServerClient({ admin: true });
    const { error } = await client
      .from("products")
      .select("id")
      .limit(1)
      .abortSignal(signal);
    if (error) throw error;
  });

  return NextResponse.json({
    ok: rawAnon.ok && anonClient.ok && adminClient.ok,
    timeoutMs: TIMEOUT_MS,
    probes: [rawAnon, anonClient, adminClient],
  });
}
