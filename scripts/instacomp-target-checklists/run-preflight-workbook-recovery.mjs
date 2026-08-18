import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const keys = JSON.parse(process.env.RECOVERY_EXACT_KEYS_JSON || "[]");
if (!Array.isArray(keys) || !keys.length || keys.some((key) => !String(key).startsWith("hockey|"))) {
  throw new Error("RECOVERY_EXACT_KEYS_JSON must contain at least one Hockey exact-set key.");
}
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "recover-selected-workbooks.mjs");
const runtimePath = resolve(here, `.recover-selected-workbooks.preflight-${process.pid}-${Date.now()}.mjs`);
let source = readFileSync(sourcePath, "utf8");
source = source.replace(/const EXACT_KEYS = new Set\(\[.*?\]\);/s, `const EXACT_KEYS = new Set(JSON.parse(process.env.RECOVERY_EXACT_KEYS_JSON || "[]"));`);
source = source.replace(
  'import { persistPlanStaged } from "./staged-registry-writer.mjs";',
  'import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";'
);
source = source.replace(
  'try { return await persistPlanStaged(db,plan,bytes); }',
  'try { const slug=String(plan?.release?.releaseSlug||""); if(!slug) throw new Error(`Missing releaseSlug for ${exactSetKey}`); const before=await preflightReleaseManagement(slug); if(before?.complete) return {status:"already_live",preflight:before}; return await persistPlanManagement(plan,bytes); }'
);
if (!source.includes('preflightReleaseManagement(slug)')) throw new Error("Failed to patch workbook recovery to preflight-first management persistence.");
writeFileSync(runtimePath, source);
try {
  await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);
} finally {
  rmSync(runtimePath, { force: true });
}
