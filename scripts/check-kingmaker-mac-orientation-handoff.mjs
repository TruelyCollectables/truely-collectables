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
  "frontRotation: params.webOrientation.frontRotation",
  "backRotation: params.webOrientation.backRotation",
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

if (!source.includes('normalizedSides.orientation.status !== "completed"')) {
  throw new Error("KINGMAKER must fail closed before trusting an uncompleted web orientation receipt.");
}

console.log("KINGMAKER trusted web orientation is fail-closed and forwarded to the Mac archive.");
