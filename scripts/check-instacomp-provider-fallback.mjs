import fs from "node:fs";

const failover = fs.readFileSync(
  "src/lib/instacomp-ai-provider-failover.ts",
  "utf8",
);
const scan = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const failures = [];

if (!failover.includes("INSTACOMP_INTERNAL_ENGINE_NOT_CONFIGURED")) {
  failures.push("missing internal-engine configuration failure");
}
if (!failover.includes("INSTACOMP_INTERNAL_ENGINE_OFFLINE")) {
  failures.push("missing internal-engine offline failure");
}
if (!failover.includes("isInstaCompInternalEmergencyEligible")) {
  failures.push("missing explicit emergency eligibility gate");
}
if (!failover.includes("model_unavailable")) {
  failures.push("model failure classification missing");
}
if (!failover.includes("Reader failures:")) {
  failures.push("durable reader failure summary missing");
}

const internalProvider = scan.indexOf('provider: "instacomp_internal"');
const emergencyProvider = scan.indexOf('provider: "openai_emergency"');
if (
  internalProvider < 0 ||
  emergencyProvider < 0 ||
  internalProvider >= emergencyProvider
) {
  failures.push("scan does not keep InstaComp before OpenAI emergency");
}
if (!scan.includes("[INSTACOMP_OPENAI_MODEL, INSTACOMP_OPENAI_FALLBACK_MODEL]")) {
  failures.push("OpenAI emergency path does not retain its model fallback");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("InstaComp provider fallback gate PASSED");
