import { createClient } from "@supabase/supabase-js";

type CloudflareFetchGlobal = typeof globalThis & {
  __TRUELY_CLOUDFLARE_NATIVE_FETCH__?: typeof fetch;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

const nativeFetch = (globalThis as CloudflareFetchGlobal)
  .__TRUELY_CLOUDFLARE_NATIVE_FETCH__;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  typeof nativeFetch === "function"
    ? { global: { fetch: nativeFetch } }
    : undefined,
);
