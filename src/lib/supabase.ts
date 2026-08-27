import { createClient } from "@supabase/supabase-js";

type CloudflareFetchGlobal = typeof globalThis & {
  __TRUELY_CLOUDFLARE_NATIVE_FETCH__?: typeof fetch;
};

const nativeFetch = (globalThis as CloudflareFetchGlobal)
  .__TRUELY_CLOUDFLARE_NATIVE_FETCH__;

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    typeof nativeFetch === "function"
      ? { global: { fetch: nativeFetch } }
      : undefined,
  );
}

let cachedSupabaseClient: any = null;

function getSupabaseClient(): any {
  if (!cachedSupabaseClient) {
    cachedSupabaseClient = createSupabaseClient();
  }

  return cachedSupabaseClient;
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
