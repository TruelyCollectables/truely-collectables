import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

const page = read("src/app/admin/ebay/launch-ready-sync/page.tsx");
assert.ok(page.includes("LaunchReadySyncClient"));
assert.ok(page.includes("eBay Launch Readiness"));
assert.ok(page.includes("/admin/ebay/sync-control"));

const client = read(
  "src/app/admin/ebay/launch-ready-sync/LaunchReadySyncClient.tsx",
);
for (const token of [
  "Preview eBay Sync",
  "Apply Launch-Ready Sync",
  "/api/admin/ebay/launch-ready-sync",
  "deactivateEnded: true",
  "Sync and Audit Report",
  "up to 20 photos",
  "Best Offer evidence",
  "shipping rules",
]) {
  assert.ok(client.includes(token), `Launch-ready admin UI must include ${token}.`);
}
assert.ok(client.includes('method: mode === "preview" ? "GET" : "POST"'));
assert.ok(client.includes("payload.success !== true"));

console.log("eBay launch-ready admin UI simulations passed.");
