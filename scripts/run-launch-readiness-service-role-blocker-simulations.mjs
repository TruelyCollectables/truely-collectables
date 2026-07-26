import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pagePath = path.join(
  process.cwd(),
  "src/app/admin/launch-readiness/page.tsx",
);
const routePath = path.join(
  process.cwd(),
  "src/app/api/admin/launch-readiness/route.ts",
);

for (const requiredPath of [pagePath, routePath]) {
  assert.ok(fs.existsSync(requiredPath), `Required Launch Readiness source is missing: ${requiredPath}`);
}

const pageSource = fs.readFileSync(pagePath, "utf8");
const routeSource = fs.readFileSync(routePath, "utf8");

for (const [label, fragment] of [
  ["service-role label", 'label: "Supabase Service Role"'],
  ["blocked service-role status", '? "ready"\n        : "blocked"'],
  [
    "fail-closed operator detail",
    "Privileged Supabase clients fail closed, so admin writes, database launch checks, and payment webhooks cannot rely on the public anon key.",
  ],
  [
    "Vercel Production remediation",
    "Set SUPABASE_SERVICE_ROLE_KEY in the Vercel Production environment and the local operator environment",
  ],
]) {
  assert.ok(pageSource.includes(fragment), `Launch Readiness page is missing ${label}.`);
}

assert.ok(
  !pageSource.includes(
    "Admin-only writes and webhook operations currently fall back to the public anon key.",
  ),
  "Launch Readiness must not claim privileged operations fall back to the anon key.",
);

for (const [label, fragment] of [
  ["missing bootstrap detector", "function missingPrivilegedSupabaseEnvironment"],
  ["service-role required name", '"SUPABASE_SERVICE_ROLE_KEY"'],
  ["structured blocker builder", "function buildPrivilegedSupabaseBlocker"],
  ["safe Markdown blocker", "function privilegedSupabaseBlockerMarkdown"],
  ["HTTP service unavailable status", "status: 503"],
  ["blocked JSON result", "success: false"],
  ["no deployment evidence", "deploymentStarted: false"],
  ["no secret-value evidence", "environmentValuesReadOrPrinted: false"],
]) {
  assert.ok(routeSource.includes(fragment), `Launch Readiness API is missing ${label}.`);
}

const bootstrapCheckIndex = routeSource.indexOf(
  "const missingEnvironmentVariables = missingPrivilegedSupabaseEnvironment();",
);
const buildBriefIndex = routeSource.indexOf(
  "const brief = await buildBrief(requestUrl.origin);",
);
assert.ok(
  bootstrapCheckIndex >= 0 &&
    buildBriefIndex >= 0 &&
    bootstrapCheckIndex < buildBriefIndex,
  "Launch Readiness must block on missing Supabase bootstrap names before privileged database evaluation.",
);

console.log(
  "Launch Readiness service-role blocker simulations passed: dashboard, JSON and Markdown handoffs fail closed before privileged database evaluation.",
);
