import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = readFileSync("src/lib/instacomp-mac-registry-client.ts","utf8");
const pending = readFileSync("src/app/api/account/seller/instacomp-pending/route.ts","utf8");
const service = readFileSync("services/instacomp-ai/app/main.py","utf8");

assert.match(registry, /path === "\/v1\/kingmaker\/accounting\/commercial-inventory"/);
assert.match(registry, /"\/v1\/obbfb-inventory\/commercial"/);
assert.equal(pending.includes("/v1/kingmaker/accounting/commercial-inventory"), false);
assert.equal(pending.split("/v1/obbfb-inventory/commercial").length, 5);
assert.match(service, /app\.add_api_route\([\s\S]*?"\/v1\/obbfb-inventory\/commercial"/);
assert.match(service, /dependencies=list\(_commercial_route\.dependencies\)/);
console.log("PASS: OBBFB Mac registry tunnel bypass preserves FastAPI authentication and pending inventory access");
