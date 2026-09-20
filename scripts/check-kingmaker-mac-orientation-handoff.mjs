import fs from "node:fs";

const path = "src/app/api/kingmaker/instacomp-front-back-exact/route.ts";
const source = fs.readFileSync(path, "utf8");
const start = source.indexOf("async function archiveWithMacBestEffort");
const end = source.indexOf("async function saveFailure", start);
if (start < 0 || end < 0) {
  throw new Error("Could not locate KINGMAKER Mac archive helper.");
}
const helper = source.slice(start, end);
for (const required of [
  "frontRotation: webOrientationTrusted",
  "quarterTurn(params.webOrientation?.frontRotation)",
  "backRotation: webOrientationTrusted",
  "quarterTurn(params.webOrientation?.backRotation)",
]) {
  if (!helper.includes(required)) {
    throw new Error(`Missing trusted orientation handoff: ${required}`);
  }
}
for (const forbidden of ["frontRotation: null", "backRotation: null"]) {
  if (helper.includes(forbidden)) {
    throw new Error(`KINGMAKER Mac archive must not discard proven rotation: ${forbidden}`);
  }
}

if (!helper.includes('params.webOrientation?.status === "completed"')) {
  throw new Error("KINGMAKER must only forward web rotation hints from a completed orientation receipt.");
}


const stablePairStart = source.indexOf("const stablePairArchive: MacArchiveResult | null");
const stablePairEnd = source.indexOf("// First-time/unresolved cards still run the physical Mac scan.", stablePairStart);
if (stablePairStart < 0 || stablePairEnd < 0) {
  throw new Error("Could not locate unchanged exact-pair fast return.");
}
const stablePairBlock = source.slice(stablePairStart, stablePairEnd);
if (!stablePairBlock.includes("stablePairRegistryCandidate" + "\n        ? {")) {
  throw new Error("An unchanged exact Registry pair must fast-return even when orientation remains review-only.");
}
if (stablePairBlock.includes("stablePairRegistryCandidate && storedPairOrientation")) {
  throw new Error("Orientation must not be a prerequisite for exact Registry identity fast return.");
}

console.log("KINGMAKER trusted web orientation is fail-closed and forwarded to the Mac archive.");
