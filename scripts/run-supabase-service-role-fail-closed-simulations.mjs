import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sourcePath = path.join(process.cwd(), "src/lib/supabase-server.ts");
assert.ok(fs.existsSync(sourcePath), "Supabase server client source is missing.");

const source = fs.readFileSync(sourcePath, "utf8");

for (const [label, pattern] of [
  ["dedicated service-role getter", /function getServiceRoleKey\(\)/],
  [
    "missing service-role rejection",
    /throw new Error\("Missing Supabase service role key environment variable"\)/,
  ],
  [
    "admin client service-role selection",
    /options\?\.admin\s*\?\s*getServiceRoleKey\(\)\s*:\s*getAnonKey\(\)/,
  ],
]) {
  assert.match(source, pattern, `Supabase server client is missing ${label}.`);
}

assert.doesNotMatch(
  source,
  /options\?\.admin[\s\S]{0,160}?serviceRoleKey[\s\S]{0,160}?:\s*getAnonKey\(\)/,
  "Admin Supabase clients must fail closed instead of falling back to the public anon key.",
);

console.log(
  "Supabase service-role fail-closed simulations passed: admin clients require SUPABASE_SERVICE_ROLE_KEY and public clients continue to use the anon key.",
);
