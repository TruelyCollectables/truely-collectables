import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function source(file: string) {
  return fs.readFileSync(file, "utf8");
}

function filesUnder(root: string) {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else result.push(full);
  }
  return result;
}

const session = source("src/lib/admin-session.ts");
const proxy = source("src/proxy.ts");
const handoff = source("src/lib/admin-handoff.ts");
const login = source("src/app/api/admin/login/route.ts");
const bootstrap = source(
  "src/app/api/admin/verified-reference-bootstrap/route.ts",
);

for (const contract of [
  'purpose: "cookie" | "internal" = "internal"',
  'if (purpose !== "cookie")',
  'return ""',
]) {
  assert.ok(session.includes(contract), `Admin session factory is missing ${contract}.`);
}
assert.ok(
  login.includes('createAdminSessionValue("cookie")'),
  "Password login must explicitly request a cookie session.",
);
assert.ok(
  bootstrap.includes('createAdminSessionValue("cookie")'),
  "The protected internal bootstrap must explicitly request a cookie session.",
);

assert.ok(
  proxy.includes('searchParams.has("admin_handoff")') &&
    proxy.includes('searchParams.delete("admin_handoff")'),
  "Legacy admin handoff query parameters must be stripped immediately.",
);
assert.doesNotMatch(
  proxy,
  /isValidAdminSessionValue\(adminHandoff\)/,
  "A query parameter must never establish an administrator session.",
);
assert.doesNotMatch(
  proxy,
  /appendAdminSessionCookies[\s\S]*adminHandoff/,
  "A query parameter must never be promoted into an administrator cookie.",
);

assert.ok(
  handoff.includes("return href") && handoff.includes("return null"),
  "Legacy handoff helpers must stop adding or reading administrator tokens in URLs.",
);

const adminPages = filesUnder("src/app/admin").filter((file) =>
  /\.(?:ts|tsx)$/.test(file),
);
for (const file of adminPages) {
  const text = source(file);
  assert.doesNotMatch(
    text,
    /await createAdminSessionValue\(\)/,
    `${file} must not mint a full administrator session into rendered HTML.`,
  );
}

console.log(
  "Administrator cookie-only session and URL-leak simulations passed.",
);
