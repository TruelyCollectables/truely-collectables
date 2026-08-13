import { createClient } from "@supabase/supabase-js";

type CloudflareFetchGlobal = typeof globalThis & {
  __TRUELY_CLOUDFLARE_NATIVE_FETCH__?: typeof fetch;
};

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

function getServerFetch() {
  const nativeFetch = (globalThis as CloudflareFetchGlobal)
    .__TRUELY_CLOUDFLARE_NATIVE_FETCH__;
  return typeof nativeFetch === "function" ? nativeFetch : undefined;
}

export function createSupabaseServerClient(options?: { admin?: boolean }) {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = options?.admin ? getServiceRoleKey() : getAnonKey();
  const nativeFetch = getServerFetch();

  return createClient(supabaseUrl, supabaseKey, {
    ...(nativeFetch ? { global: { fetch: nativeFetch } } : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
