import assert from "node:assert/strict";
import fs from "node:fs";

const routePath = "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts";
const route = fs.readFileSync(routePath, "utf8");

const lookupStart = route.indexOf('let query = supabase');
const lookupEnd = route.indexOf('query = isOwner', lookupStart);
assert.ok(lookupStart >= 0 && lookupEnd > lookupStart, "card edit lookup query must exist");
const lookup = route.slice(lookupStart, lookupEnd);
assert.equal(
  lookup.includes('.eq("status", "draft")'),
  false,
  "Master Listings edit lookup must not be restricted to draft rows",
);

assert.ok(
  route.includes('if (item.status === "archived" || item.status === "sold")'),
  "Archived/sold inventory must remain protected from editing",
);
assert.ok(
  route.includes('.neq("status", "archived")') && route.includes('.neq("status", "sold")'),
  "Save must reject a row that becomes archived/sold during the edit",
);
assert.ok(
  route.includes('.select("id,status")') && route.includes('.maybeSingle()'),
  "Save must prove the inventory row was actually updated",
);
assert.equal(
  route.includes('{ error: "Pending card was not found." }'),
  false,
  "Master Listings edit failures must not claim every editable row is Pending",
);

console.log("KINGMAKER Master Listings edit regressions passed.");
