import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proxySource = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");

for (const exactPublicPath of [
  '"/admin/login"',
  '"/admin/reset-password"',
  '"/api/admin/login"',
  '"/api/admin/password-reset/request"',
  '"/api/admin/password-reset/confirm"',
]) {
  assert.ok(
    proxySource.includes(exactPublicPath),
    `Expected exact public admin recovery path ${exactPublicPath}.`,
  );
}

assert.match(
  proxySource,
  /const PUBLIC_ADMIN_RECOVERY_PATHS = new Set\(\[/,
  "Recovery exemptions must be an exact-path set.",
);
assert.match(
  proxySource,
  /if \(PUBLIC_ADMIN_RECOVERY_PATHS\.has\(pathname\)\) \{\s*return false;\s*\}/,
  "Exact recovery routes must be exempted before protected admin prefixes.",
);
assert.match(
  proxySource,
  /if \(pathname\.startsWith\("\/admin"\)\) \{\s*return true;\s*\}/,
  "All other admin pages must remain protected.",
);
assert.match(
  proxySource,
  /if \(pathname\.startsWith\("\/api\/admin"\)\) \{\s*return true;\s*\}/,
  "All other admin APIs must remain protected.",
);

for (const forbiddenBroadExemption of [
  'pathname.startsWith("/admin/reset")',
  'pathname.startsWith("/api/admin/password-reset")',
  'pathname.includes("password-reset")',
]) {
  assert.ok(
    !proxySource.includes(forbiddenBroadExemption),
    `Recovery must not use broad exemption ${forbiddenBroadExemption}.`,
  );
}

assert.ok(
  !proxySource.includes('"/api/admin/market-intel/profit-hunter-token"'),
  "The private Profit Hunter token route must not be added to the public recovery set.",
);
assert.match(
  proxySource,
  /return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/,
  "Protected admin APIs must continue to fail with HTTP 401.",
);

console.log(
  "Admin password recovery proxy contract passed: only login, reset page, reset request, and reset confirmation are public; every other admin page and API remains protected.",
);
