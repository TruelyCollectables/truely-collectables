import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetPath = resolve(process.cwd(), "scripts/import-hockey-2021plus-priority.mjs");
let source = readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}.`);
  source = source.replace(before, after);
}

replaceOnce('  persistPlan,\n', '', 'remove legacy persistPlan import');
replaceOnce(
  '} from "./mainstream-checklist/registry-tools.mjs";\n',
  '} from "./mainstream-checklist/registry-tools.mjs";\nimport { persistBulkPlan } from "./mainstream-checklist/bulk-registry-tools.mjs";\n',
  'add bulk persistence import',
);
replaceOnce(
  '  plan.adapterVersion = "1.1.0";\n  assertPlanComplexity(plan);\n',
  '  plan.adapterVersion = "1.1.0";\n' +
    '  const storagePath = plan.source.storage.objectPath;\n' +
    '  const slash = storagePath.lastIndexOf("/");\n' +
    '  plan.source.storage.objectPath = storagePath.slice(0, slash + 1) + "bulk-v2-" + storagePath.slice(slash + 1);\n' +
    '  assertPlanComplexity(plan);\n',
  'use collision-free Upper Deck v2 source path',
);
replaceOnce(
  "  const persistence = await retry(`persist ${target.release.exactSetKey}`, () => persistPlan(db, plan, source.bytes), 4);\n",
  "  const persistence = await retry(`bulk persist ${target.release.exactSetKey}`, () => persistBulkPlan(db, plan, source.bytes), 4);\n",
  'switch hockey persistence to bulk writer',
);

writeFileSync(targetPath, source, "utf8");
console.log("Hockey loader patched onto bulk Registry writer.");
