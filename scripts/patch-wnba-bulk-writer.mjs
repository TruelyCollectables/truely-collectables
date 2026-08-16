import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetPath = resolve(process.cwd(), "scripts/import-wnba-panini-pdfs.mjs");
let source = readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}.`);
  source = source.replace(before, after);
}

replaceOnce(
  '  persistPlan,\n',
  '',
  'remove legacy persistPlan import',
);
replaceOnce(
  '} from "./mainstream-checklist/registry-tools.mjs";\n',
  '} from "./mainstream-checklist/registry-tools.mjs";\nimport { persistBulkPlan } from "./mainstream-checklist/bulk-registry-tools.mjs";\n',
  'add bulk persistence import',
);
replaceOnce(
  'return /timed? out|too many connections|connection.*database|fetch failed|socket|econn|503|504|502|429|temporar/i.test(\n',
  'return /timed? out|too many connections|connection.*database|fetch failed|socket|econn|520|503|504|502|429|cloudflare|web server is returning|temporar/i.test(\n',
  'expand transient transport errors',
);
replaceOnce(
`  const plan = buildPlan(entryFor(target), parsed, source, checkedAt);
  const complexity = assertPlanComplexity(plan);
`,
`  const plan = buildPlan(entryFor(target), parsed, source, checkedAt);
  plan.adapterId = "panini-pdf-tsv-v2";
  plan.adapterVersion = "1.1.0";
  // A prior partial release can legitimately have the same source SHA attached to
  // an older Registry release row. Use a deterministic v2 object name so the
  // global storage-path uniqueness constraint cannot block the corrected import.
  const storagePath = plan.source.storage.objectPath;
  const slash = storagePath.lastIndexOf("/");
  plan.source.storage.objectPath = `${storagePath.slice(0, slash + 1)}bulk-v2-${storagePath.slice(slash + 1)}`;
  const complexity = assertPlanComplexity(plan);
`,
  'set WNBA v2 adapter and collision-free source path',
);
replaceOnce(
`  const persistence = await retry(` + '`' + `Registry persistence ${target.name}` + '`' + `, () =>
    persistPlan(db, plan, source.bytes),
  );
`,
`  const persistence = await retry(` + '`' + `Registry bulk persistence ${target.name}` + '`' + `, () =>
    persistBulkPlan(db, plan, source.bytes),
  );
`,
  'switch to bulk Registry writer',
);
replaceOnce(
`    }
  }

  const imported = results.filter(
`,
`    }
    // Give the managed database pool a small recovery window between large atomic
    // releases. This prevents one completed import from starving the next archive.
    await sleep(2_000);
  }

  const imported = results.filter(
`,
  'serialize release recovery window',
);

writeFileSync(targetPath, source, "utf8");
console.log("WNBA loader patched: bulk Registry writer + adapter v1.1.0 + collision-free source path.");
