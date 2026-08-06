import fs from "node:fs";

const failover = fs.readFileSync(
  "src/lib/instacomp-ai-provider-failover.ts",
  "utf8",
);
const scan = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const readiness = fs.readFileSync(
  "src/app/api/instacomp/internal-readiness/route.ts",
  "utf8",
);
const failures = [];

if (!failover.includes("INSTACOMP_INTERNAL_ENGINE_NOT_CONFIGURED")) {
  failures.push("missing internal-engine configuration failure");
}
if (!failover.includes("INSTACOMP_INTERNAL_ENGINE_OFFLINE")) {
  failures.push("missing internal-engine offline failure");
}
if (!failover.includes("INSTACOMP_INTERNAL_ENGINE_SCAN_FAILED")) {
  failures.push("missing internal-engine scan failure");
}
if (failover.includes("isInstaCompInternalEmergencyEligible")) {
  failures.push("emergency eligibility gate still exists");
}
if (scan.includes('provider: "openai_emergency"')) {
  failures.push("OpenAI emergency identity reader still exists");
}
if (!scan.includes('provider: "instacomp_internal"')) {
  failures.push("InstaComp internal identity reader is missing");
}
if (!scan.includes("const serialOcr = null as InstaCompSerialOcrResult | null;")) {
  failures.push("external serial identity reader is not disabled");
}
if (!scan.includes("runSecondaryVision: false")) {
  failures.push("external AI council is not disabled");
}
if (!scan.includes('requestedTier: "basic"')) {
  failures.push("AI council is not pinned to its zero-reader tier");
}
if (readiness.includes("openAiEmergencyConfigured")) {
  failures.push("readiness still advertises OpenAI emergency");
}
if (readiness.includes("openai_emergency")) {
  failures.push("readiness architecture still includes OpenAI emergency");
}
if (!readiness.includes('architecture: ["instacomp_ai"]')) {
  failures.push("readiness does not advertise the single InstaComp AI engine");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("InstaComp-only identity gate PASSED");
