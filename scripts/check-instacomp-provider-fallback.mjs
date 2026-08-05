import fs from "node:fs";

const failover = fs.readFileSync("src/lib/instacomp-ai-provider-failover.ts", "utf8");
const scan = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const failures = [];

for (const [text, reason] of [
  ['process.env.INSTACOMP_OPENAI_FALLBACK_MODEL = "gpt-4o-mini"', "production vision fallback must be forced before scan model constants resolve"],
  ['model_unavailable', "model access failures must be classified"],
  ['Reader failures:', "provider failures must remain visible in the durable card error"],
]) {
  if (!failover.includes(text)) failures.push(reason);
}

if (!scan.includes('INSTACOMP_OPENAI_FALLBACK_MODEL')) {
  failures.push("scan route must consume the fallback model");
}
if (!scan.includes('[INSTACOMP_OPENAI_MODEL, INSTACOMP_OPENAI_FALLBACK_MODEL]')) {
  failures.push("primary scan must attempt primary and fallback models");
}

if (failures.length) {
  console.error("InstaComp provider fallback gate FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("InstaComp provider fallback gate PASSED");
