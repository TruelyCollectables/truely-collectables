import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const keys = JSON.parse(process.env.RECOVERY_EXACT_KEYS_JSON || "[]");
if (!Array.isArray(keys) || !keys.length || keys.some((key) => !String(key).startsWith("hockey|"))) {
  throw new Error("RECOVERY_EXACT_KEYS_JSON must contain at least one requested Hockey exact-set key.");
}
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "recover-selected-workbooks.mjs");
const runtimePath = resolve(here, `.recover-selected-workbooks.runtime-${process.pid}-${Date.now()}.mjs`);
const source = readFileSync(sourcePath, "utf8");
const replacement = `const EXACT_KEYS = new Set(JSON.parse(process.env.RECOVERY_EXACT_KEYS_JSON || "[]"));`;
const patched = source.replace(/const EXACT_KEYS = new Set\(\[.*?\]\);/s, replacement);
if (patched === source) throw new Error("Failed to parameterize workbook recovery EXACT_KEYS.");
writeFileSync(runtimePath, patched);
try {
  await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);
} finally {
  rmSync(runtimePath, { force: true });
}
