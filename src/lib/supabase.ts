import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://rfdzsoykhnngzdnvzlhz.supabase.co";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "PLACEHOLDER_KEY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);