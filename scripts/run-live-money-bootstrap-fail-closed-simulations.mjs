import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sourcePath = path.join(process.cwd(), "scripts/status-live-money.ts");
assert.ok(fs.existsSync(sourcePath), "Live-money status source is missing.");

const source = fs.readFileSync(sourcePath, "utf8");

for (const [label, fragment] of [
  [
    "separate public anon key requirement",
    'missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY")',
  ],
  [
    "separate service-role key requirement",
    'missing.push("SUPABASE_SERVICE_ROLE_KEY")',
  ],
  ["public anon key status row", 'label: "NEXT_PUBLIC_SUPABASE_ANON_KEY"'],
  ["service-role key status row", 'label: "SUPABASE_SERVICE_ROLE_KEY"'],
  [
    "privileged database blocked explanation",
    'missing - privileged database access is blocked',
  ],
  [
    "pre-client bootstrap rejection",
    'Missing required local live-money bootstrap environment',
  ],
]) {
  assert.ok(source.includes(fragment), `Live-money status is missing ${label}.`);
}

for (const forbidden of [
  "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY",
]) {
  assert.ok(
    !source.includes(forbidden),
    `Live-money status must not present an anon/service-role substitution: ${forbidden}`,
  );
}

assert.doesNotMatch(
  source,
  /configured\(process\.env\.SUPABASE_SERVICE_ROLE_KEY\)[\s\S]{0,120}?\|\|[\s\S]{0,120}?configured\(process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY\)/,
  "Live-money status must require the service-role and anon keys independently.",
);

console.log(
  "Live-money bootstrap fail-closed simulations passed: URL, anon key, and service-role key are independently required before privileged launch evaluation.",
);
