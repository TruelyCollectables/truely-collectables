import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  "src/lib/instacomp-teacher-market-provider.ts",
  "utf8",
);
const smoke = fs.readFileSync(
  "src/app/api/release/instacomp-gateway-teacher-smoke/route.ts",
  "utf8",
);

assert.match(source, /import \{ gateway \} from "@ai-sdk\/gateway"/);
assert.doesNotMatch(source, /createGateway/);
assert.match(source, /inclusionai\/ling-3\.0-flash-free/);
assert.match(source, /poolside\/laguna-s-2\.1-free/);
assert.doesNotMatch(source, /google\/gemini-3\.6-flash/);
assert.doesNotMatch(source, /xai\/grok-4\.5/);
assert.match(source, /gateway_inclusionai/);
assert.match(source, /gateway_poolside/);
assert.doesNotMatch(source, /gateway_google/);
assert.doesNotMatch(source, /gateway_xai/);
assert.match(source, /process\.env\.VERCEL === "1"/);
assert.match(source, /perplexitySearch\(\{/);
assert.match(source, /searchDomainFilter:\s*\["ebay\.com",\s*"130point\.com"\]/);
assert.match(source, /parallelSearch\(\{/);
assert.match(source, /includeDomains:\s*\["ebay\.com",\s*"130point\.com"\]/);
assert.match(source, /toolName:\s*"perplexity_search"/);
assert.match(source, /toolName:\s*"parallel_search"/);
assert.match(source, /model:\s*GATEWAY_INCLUSIONAI_MODEL/);
assert.match(source, /model:\s*GATEWAY_POOLSIDE_MODEL/);
assert.match(source, /filterStrictExactMarketMatches/);
assert.match(source, /teacher_consensus_exact_sold/);
assert.match(source, /eligible to teach InstaComp AI/);
assert.doesNotMatch(source, /pricing_authority\s*=\s*true/i);
assert.doesNotMatch(source, /x-vercel-oidc-token/i);
assert.doesNotMatch(smoke, /x-vercel-oidc-token/i);
assert.match(smoke, /automaticVercelGatewayAuthProven/);

console.log("InstaComp free-tier Vercel Gateway automatic-OIDC teacher safety contract passed.");
