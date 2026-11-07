import { createClient } from "@supabase/supabase-js";

type CloudflareFetchGlobal = typeof globalThis & {
  __TRUELY_CLOUDFLARE_NATIVE_FETCH__?: typeof fetch;
};

// A server-side read that needs multiple seconds is already unhealthy for a
// storefront request. Abort it before it can pin a PostgREST transaction or
// consume a connection long enough to cascade into a site-wide outage. Writes
// are intentionally not covered by this timeout.
const DEFAULT_SERVER_READ_TIMEOUT_MS = 4_000;

function getSupabaseUrl() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL environment variable");
  }

  return supabaseUrl;
}

function getAnonKey() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!anonKey) {
    throw new Error("Missing Supabase anon key environment variable");
  }

  return anonKey;
}

function getServiceRoleKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey?.trim()) {
    throw new Error("Missing Supabase service role key environment variable");
  }

  return serviceRoleKey.trim();
}

function requestMethod(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function requestSignal(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  if (init?.signal) return init.signal;
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.signal;
  }
  return undefined;
}

function createBoundedReadFetch(
  nativeFetch: typeof fetch,
  readTimeoutMs: number,
): typeof fetch {
  return async (input, init) => {
    const method = requestMethod(input, init);
    if (method !== "GET" && method !== "HEAD") {
      return nativeFetch(input, init);
    }

    const upstreamSignal = requestSignal(input, init);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(upstreamSignal?.reason);

    if (upstreamSignal?.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
    }

    const timeout = setTimeout(() => controller.abort(), readTimeoutMs);

    try {
      return await nativeFetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", forwardAbort);
    }
  };
}

function getServerFetch() {
  const nativeFetch = (globalThis as CloudflareFetchGlobal)
    .__TRUELY_CLOUDFLARE_NATIVE_FETCH__;
  return typeof nativeFetch === "function" ? nativeFetch : undefined;
}

export function createSupabaseServerClient(options?: {
  admin?: boolean;
  readTimeoutMs?: number;
}) {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = options?.admin ? getServiceRoleKey() : getAnonKey();
  const nativeFetch = getServerFetch();
  const requestedReadTimeoutMs = Number(options?.readTimeoutMs);
  const readTimeoutMs =
    Number.isFinite(requestedReadTimeoutMs) && requestedReadTimeoutMs > 0
      ? Math.min(60_000, Math.max(1_000, Math.floor(requestedReadTimeoutMs)))
      : DEFAULT_SERVER_READ_TIMEOUT_MS;

  return createClient(supabaseUrl, supabaseKey, {
    ...(nativeFetch
      ? { global: { fetch: createBoundedReadFetch(nativeFetch, readTimeoutMs) } }
      : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
