import assert from "node:assert/strict";
import fs from "node:fs";

const path = "src/app/account/page.tsx";
let source = fs.readFileSync(path, "utf8");

const importNeedle = `import {
  clearAccountSession,
  getAccountSession,
  type StoredAccountSession,
} from "./account-session";`;
const importReplacement = `import {
  clearAccountSession,
  fetchWithAccountSession,
  getAccountSession,
  type StoredAccountSession,
} from "./account-session";`;

assert.ok(
  source.includes(importNeedle) || source.includes("fetchWithAccountSession"),
  "Could not locate the buyer account session import block.",
);

if (!source.includes("fetchWithAccountSession")) {
  source = source.replace(importNeedle, importReplacement);
}

const before = (source.match(/\bfetch\(/g) || []).length;
source = source.replace(/\bfetch\(/g, "fetchWithAccountSession(");
const after = (source.match(/\bfetch\(/g) || []).length;
const helperCalls = (source.match(/\bfetchWithAccountSession\(/g) || []).length;

assert.equal(after, 0, "Direct fetch calls remain in the buyer Account dashboard.");
assert.ok(
  before >= 20 || helperCalls >= 20,
  `Expected at least 20 protected account requests, found direct=${before}, helper=${helperCalls}.`,
);
assert.match(
  source,
  /fetchWithAccountSession\("\/api\/account\/orders"/,
  "The account order summary must use the refresh-and-retry helper.",
);
assert.match(
  source,
  /fetchWithAccountSession\("\/api\/account\/seller\/payout-requests"/,
  "Seller payout requests inside the account dashboard must use the refresh-and-retry helper.",
);
assert.match(
  source,
  /fetchWithAccountSession\("\/api\/account\/collector\/items"/,
  "Collector requests inside the account dashboard must use the refresh-and-retry helper.",
);

fs.writeFileSync(path, source);
console.log(
  JSON.stringify({
    path,
    replacedDirectFetchCalls: before,
    authenticatedAccountFetchCalls: helperCalls,
  }),
);
