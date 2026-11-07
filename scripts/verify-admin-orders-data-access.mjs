import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/app/admin/orders/page.tsx", import.meta.url),
  "utf8",
);

assert(
  source.includes(
    'import { createSupabaseServerClient } from "../../../lib/supabase-server";',
  ),
  "Admin orders must import the server-only Supabase client.",
);

assert(
  source.includes("createSupabaseServerClient({ admin: true })"),
  "Admin orders must use the service-role Supabase client.",
);

assert(
  !source.includes('import { supabase } from "../../../lib/supabase";'),
  "Admin orders must not use the public anonymous Supabase client.",
);

assert(
  source.includes('.from("orders")') && source.includes('.from("order_items")'),
  "Admin orders must load both orders and order_items explicitly.",
);

console.log("PASS admin orders uses server-only service-role data access");
