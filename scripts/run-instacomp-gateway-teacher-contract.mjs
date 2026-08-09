import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  "src/lib/instacomp-teacher-market-provider.ts",
  "utf8",
);

assert.match(source, /createGateway/);
assert.match(source, /google\/gemini-3\.6-flash/);
assert.match(source, /xai\/grok-4\.5/);
assert.match(source, /gateway_google/);
assert.match(source, /gateway_xai/);
assert.match(source, /perplexitySearch\(\{/);
assert.match(source, /searchDomainFilter:\s*\["ebay\.com",\s*"130point\.com"\]/);
assert.match(source, /parallelSearch\(\{/);
assert.match(source, /includeDomains:\s*\["ebay\.com",\s*"130point\.com"\]/);
assert.match(source, /toolName:\s*"perplexity_search"/);
assert.match(source, /toolName:\s*"parallel_search"/);
assert.match(source, /gatewayOidcToken\?: string/);
assert.match(source, /!GEMINI_API_KEY/);
assert.match(source, /!XAI_API_KEY/);
assert.match(source, /filterStrictExactMarketMatches/);
assert.match(source, /teacher_consensus_exact_sold/);
assert.match(source, /eligible to teach InstaComp AI/);
assert.doesNotMatch(source, /pricing_authority\s*=\s*true/i);

console.log("InstaComp Vercel Gateway teacher safety contract passed.");
