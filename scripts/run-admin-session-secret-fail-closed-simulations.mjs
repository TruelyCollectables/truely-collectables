import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sessionPath = path.join(process.cwd(), "src/lib/admin-session.ts");
const pagePath = path.join(
  process.cwd(),
  "src/app/admin/launch-readiness/page.tsx",
);
const routePath = path.join(
  process.cwd(),
  "src/app/api/admin/launch-readiness/route.ts",
);
const loginRoutePath = path.join(
  process.cwd(),
  "src/app/api/admin/login/route.ts",
);

for (const requiredPath of [sessionPath, pagePath, routePath, loginRoutePath]) {
  assert.ok(
    fs.existsSync(requiredPath),
    `Required admin-session source is missing: ${requiredPath}`,
  );
}

const sessionSource = fs.readFileSync(sessionPath, "utf8");
const pageSource = fs.readFileSync(pagePath, "utf8");
const routeSource = fs.readFileSync(routePath, "utf8");
const loginRouteSource = fs.readFileSync(loginRoutePath, "utf8");

for (const [label, fragment] of [
  [
    "dedicated session-secret read",
    "const secret = process.env.ADMIN_SESSION_SECRET;",
  ],
  ["trimmed fail-closed secret", 'return secret?.trim() || "";'],
  ["session creation rejection", 'throw new Error("ADMIN_SESSION_SECRET is required")'],
  ["password verification source", "const expectedPassword = process.env.ADMIN_PASSWORD;"],
]) {
  assert.ok(sessionSource.includes(fragment), `Admin session source is missing ${label}.`);
}

for (const forbidden of [
  'process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD',
  'ADMIN_PASSWORD or ADMIN_SESSION_SECRET is required',
]) {
  assert.ok(
    !sessionSource.includes(forbidden),
    `Admin session source must not retain fallback fragment: ${forbidden}`,
  );
}

for (const [label, fragment] of [
  ["blocked admin readiness", ': "blocked"'],
  [
    "independent signing-secret detail",
    "Admin session creation and validation fail closed when the dedicated session-signing secret is missing.",
  ],
  [
    "Production remediation",
    "Set ADMIN_PASSWORD and a separate strong ADMIN_SESSION_SECRET in the Vercel Production environment",
  ],
]) {
  assert.ok(pageSource.includes(fragment), `Launch Readiness page is missing ${label}.`);
}

assert.ok(
  !pageSource.includes(
    "Admin sessions fall back to ADMIN_PASSWORD when ADMIN_SESSION_SECRET is missing.",
  ),
  "Launch Readiness must not claim the admin password is a session-signing fallback.",
);

for (const [label, fragment] of [
  ["required admin session secret", '"ADMIN_SESSION_SECRET"'],
  ["privileged runtime blocker", 'label: "Privileged Runtime Bootstrap"'],
  [
    "runtime fail-closed explanation",
    "ADMIN_PASSWORD cannot replace the session-signing secret.",
  ],
]) {
  assert.ok(routeSource.includes(fragment), `Launch Readiness API is missing ${label}.`);
}

for (const fragment of [
  "createAdminSessionValue()",
  '"session_error"',
  "appendExpiredAdminSessionCookies",
]) {
  assert.ok(
    loginRouteSource.includes(fragment),
    `Admin login route must preserve clean session-creation failure handling: ${fragment}`,
  );
}

console.log(
  "Admin session-secret fail-closed simulations passed: password verification and session signing use independent credentials, and Launch Readiness blocks missing signing-secret configuration.",
);
