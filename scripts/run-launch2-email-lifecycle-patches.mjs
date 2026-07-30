import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const sourcePath = "scripts/apply-launch2-email-lifecycle-patches.mjs";
const fixedPath = "/tmp/apply-launch2-email-lifecycle-patches-fixed.mjs";
const source = await readFile(sourcePath, "utf8");
const fixed = source.replace(
  'addressLines.join("\\n")',
  'addressLines.join("\\\\n")',
);
if (fixed === source) {
  throw new Error("Lifecycle patch escape repair anchor was not found.");
}
await writeFile(fixedPath, fixed, "utf8");
await import(pathToFileURL(fixedPath).href);
