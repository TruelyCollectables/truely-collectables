import fs from "node:fs";

const file = "scripts/run-active-market-read-freshness-simulations.ts";
let source = fs.readFileSync(file, "utf8");

const helper = `
function resultTracking(
  result: ReturnType<typeof quarantineActiveMarketTrackingForRead>,
): Json {
  return (result.tracking || {}) as Json;
}
`;
if (!source.includes("function resultTracking(")) {
  const anchor = `function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}
`;
  if (!source.includes(anchor)) {
    throw new Error("Could not find freshness test assertion helper.");
  }
  source = source.replace(anchor, `${anchor}${helper}`);
}

source = source
  .replaceAll("result.tracking?.activeMarketAttack?.suggestions?.length", "resultTracking(result).activeMarketAttack?.suggestions?.length")
  .replaceAll("result.tracking?.pricingEvidenceMode", "resultTracking(result).pricingEvidenceMode")
  .replaceAll("result.tracking?.reviewReasons?.includes", "resultTracking(result).reviewReasons?.includes")
  .replaceAll("result.tracking?.trustedForPricing", "resultTracking(result).trustedForPricing")
  .replace("const tracking = result.tracking || {};", "const tracking = resultTracking(result);");

fs.writeFileSync(file, source);
console.log("Active Market read freshness test types fixed.");
