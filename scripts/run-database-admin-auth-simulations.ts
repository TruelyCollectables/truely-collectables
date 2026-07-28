import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialSource = readFileSync("src/lib/admin-credentials.ts", "utf8");
const loginRoute = readFileSync("src/app/api/admin/login/route.ts", "utf8");
const loginPage = readFileSync("src/app/admin/login/page.tsx", "utf8");
const resetRequest = readFileSync(
  "src/app/api/admin/password-reset/request/route.ts",
  "utf8",
);
const resetConfirm = readFileSync(
  "src/app/api/admin/password-reset/confirm/route.ts",
  "utf8",
);
const resetPage = readFileSync("src/app/admin/reset-password/page.tsx", "utf8");
const tokenRoute = readFileSync(
  "src/app/api/admin/market-intel/profit-hunter-token/route.ts",
  "utf8",
);

assert.match(credentialSource, /ADMIN_AUTH_METADATA_KEY = "admin_auth_v1"/);
assert.match(credentialSource, /\.from\("store_settings"\)/);
assert.match(credentialSource, /scryptSync\(password, salt, 64\)/);
assert.match(credentialSource, /timingSafeEqual/);
assert.match(credentialSource, /randomBytes\(40\)/);
assert.match(credentialSource, /RESET_TTL_MINUTES = 30/);
assert.match(credentialSource, /resetTokenHash: tokenDigest\(token\)/);
assert.doesNotMatch(credentialSource, /password:\s*password/);
assert.match(
  credentialSource,
  /\.from\("store_settings"\)\s*\.update\(\{ metadata \}\)/,
  "Existing store settings rows must update only the supported metadata column.",
);
assert.match(
  credentialSource,
  /store_id: state\.storeId,\s*metadata,/,
  "Credential bootstrap must upsert the store id and metadata only.",
);
assert.doesNotMatch(
  credentialSource,
  /\.update\(\{ metadata, updated_at:/,
  "Credential writes must never inject an assumed updated_at column.",
);
assert.doesNotMatch(
  credentialSource,
  /store_id: state\.storeId,\s*metadata,\s*updated_at:/,
  "Credential upserts must never inject an assumed updated_at column.",
);

assert.match(loginRoute, /verifyDatabaseAdminPasswordCandidates/);
assert.match(loginRoute, /if \(databaseCredential\.configured\)/);
assert.match(loginRoute, /databaseCredentialStatus\.configured/);
assert.match(loginRoute, /verifyAdminPassword\(candidate\)/);
assert.ok(
  loginRoute.indexOf("verifyDatabaseAdminPasswordCandidates") <
    loginRoute.indexOf("verifyAdminPassword(candidate)"),
  "Database password must be authoritative before the Vercel fallback.",
);

assert.match(loginPage, /Permanent database owner password configured/);
assert.match(loginPage, /Email Owner Reset Link/);
assert.match(loginPage, /\/api\/admin\/password-reset\/request/);
assert.match(loginPage, /deployments cannot replace it/i);

assert.match(resetRequest, /createAdminPasswordReset/);
assert.match(resetRequest, /https:\/\/api\.resend\.com\/emails/);
assert.match(resetRequest, /expires in 30 minutes/i);
assert.match(resetRequest, /requestOrigin\(req\)/);

assert.match(resetConfirm, /consumeAdminPasswordReset/);
assert.match(resetConfirm, /createAdminSessionValue/);
assert.match(resetConfirm, /appendAdminSessionCookies/);
assert.match(resetConfirm, /password !== confirmation/);

assert.match(resetPage, /Choose a permanent admin password/);
assert.match(resetPage, /minLength=\{12\}/);
assert.match(resetPage, /Save Password and Open Admin/);

assert.match(tokenRoute, /acceptsHtml/);
assert.match(tokenRoute, /NextResponse\.redirect\(loginUrl, 303\)/);
assert.match(tokenRoute, /response\(\{ error: "Unauthorized" \}, 401\)/);

console.log(
  "Database-backed admin auth passed structural verification: scrypt password hashing, metadata-only Production writes, one-time reset tokens, Resend recovery, database-first login, immediate session creation, and browser-safe token-page redirect are present.",
);
