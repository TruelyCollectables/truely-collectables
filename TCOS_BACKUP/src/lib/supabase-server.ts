import { createClient } from "@supabase/supabase-js";

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

export function createSupabaseServerClient(options?: { admin?: boolean }) {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseKey =
    options?.admin && serviceRoleKey?.trim()
      ? serviceRoleKey
      : getAnonKey();

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
