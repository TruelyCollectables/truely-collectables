import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetPath = resolve(process.cwd(), "scripts/import-wnba-panini-pdfs.mjs");
let source = readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}.`);
  source = source.replace(before, after);
}

replaceOnce('  persistPlan,\n', '', 'remove legacy persistPlan import');
replaceOnce(
  '} from "./mainstream-checklist/registry-tools.mjs";\n',
  '} from "./mainstream-checklist/registry-tools.mjs";\nimport { persistChunkedPlan } from "./mainstream-checklist/chunked-registry-tools.mjs";\n',
  'add chunked persistence import',
);
replaceOnce(
  'return /timed? out|too many connections|connection.*database|fetch failed|socket|econn|503|504|502|429|temporar/i.test(\n',
  'return /timed? out|too many connections|connection.*database|fetch failed|socket|econn|520|503|504|502|429|cloudflare|web server is returning|temporar/i.test(\n',
  'expand transient transport errors',
);
replaceOnce(
  "  const plan = buildPlan(entryFor(target), parsed, source, checkedAt);\n  const complexity = assertPlanComplexity(plan);\n",
  "  const plan = buildPlan(entryFor(target), parsed, source, checkedAt);\n" +
    "  plan.adapterId = \"panini-pdf-tsv-v3\";\n" +
    "  plan.adapterVersion = \"1.2.0\";\n" +
    "  const storagePath = plan.source.storage.objectPath;\n" +
    "  const slash = storagePath.lastIndexOf(\"/\");\n" +
    "  plan.source.storage.objectPath = storagePath.slice(0, slash + 1) + \"chunk-v3-\" + storagePath.slice(slash + 1);\n" +
    "  const complexity = assertPlanComplexity(plan);\n",
  'set WNBA v3 adapter and source path',
);
replaceOnce(
  "  const persistence = await retry(`Registry persistence ${target.name}`, () =>\n    persistPlan(db, plan, source.bytes),\n  );\n",
  "  const persistence = await retry(`Registry chunked persistence ${target.name}`, () =>\n    persistChunkedPlan(db, plan, source.bytes),\n  );\n",
  'switch to chunked Registry writer',
);
replaceOnce(
  "    }\n  }\n\n  const imported = results.filter(\n",
  "    }\n    await sleep(2_000);\n  }\n\n  const imported = results.filter(\n",
  'serialize release recovery window',
);

writeFileSync(targetPath, source, "utf8");
console.log("WNBA loader patched: resumable chunked Registry writer + adapter v1.2.0.");
