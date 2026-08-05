import fs from "node:fs";
const failover = fs.readFileSync("src/lib/instacomp-ai-provider-failover.ts", "utf8");
const scan = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const failures = [];
if (!failover.includes('process.env.INSTACOMP_OPENAI_FALLBACK_MODEL = "gpt-4o-mini"')) failures.push("gpt-4o-mini fallback missing");
if (!failover.includes("model_unavailable")) failures.push("model failure classification missing");
if (!failover.includes("Reader failures:")) failures.push("durable reader failure summary missing");
if (!scan.includes('[INSTACOMP_OPENAI_MODEL, INSTACOMP_OPENAI_FALLBACK_MODEL]')) failures.push("scan does not attempt primary plus fallback");
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("InstaComp provider fallback gate PASSED");
