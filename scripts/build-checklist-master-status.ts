import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Manifest = {
  manufacturer?: string;
  totals?: { requested?: number; archived?: number; failed?: number };
  files?: unknown[];
  failures?: unknown[];
};

type ManufacturerConfig = {
  name: string;
  manifestPath: string;
};

const manufacturers: ManufacturerConfig[] = [
  { name: "Topps", manifestPath: ".topps-seed-archive/manifest.json" },
  { name: "Panini", manifestPath: ".panini-seed-archive/manifest.json" },
  { name: "Leaf", manifestPath: ".leaf-checklist-archive/manifest.json" },
];

function bar(percent: number, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

const rows = manufacturers.map(({ name, manifestPath }) => {
  const absolute = resolve(process.cwd(), manifestPath);
  if (!existsSync(absolute)) {
    return { manufacturer: name, discovered: 0, archived: 0, failed: 0, percent: 0, status: "manifest-missing" };
  }
  const manifest = JSON.parse(readFileSync(absolute, "utf8")) as Manifest;
  const discovered = Number(manifest.totals?.requested ?? 0);
  const archived = Number(manifest.totals?.archived ?? 0);
  const failed = Number(manifest.totals?.failed ?? 0);
  const percent = discovered > 0 ? Math.round((archived / discovered) * 100) : 0;
  return {
    manufacturer: name,
    discovered,
    archived,
    failed,
    percent,
    status: failed === 0 && archived === discovered && discovered > 0 ? "known-catalog-complete" : "incomplete",
  };
});

const totals = rows.reduce(
  (sum, row) => ({
    discovered: sum.discovered + row.discovered,
    archived: sum.archived + row.archived,
    failed: sum.failed + row.failed,
  }),
  { discovered: 0, archived: 0, failed: 0 },
);

const overallPercent = totals.discovered > 0 ? Math.round((totals.archived / totals.discovered) * 100) : 0;
const generatedAt = new Date().toISOString();
const report = {
  schema: "tcos.checklistMasterArchiveStatus.v1",
  generatedAt,
  definition: "Progress is archived files divided by currently discovered official checklist files. Catalog discovery can add new files later.",
  totals: { ...totals, percent: overallPercent },
  manufacturers: rows,
};

mkdirSync(resolve(process.cwd(), ".checklist-master-archive"), { recursive: true });
writeFileSync(
  resolve(process.cwd(), ".checklist-master-archive/status.json"),
  JSON.stringify(report, null, 2) + "\n",
);

const markdown = [
  "# Master Checklist Archive Status",
  "",
  `Generated: ${generatedAt}`,
  "",
  "> Progress means archived files / currently discovered official files. A manufacturer reaches 100% when every known URL in the current catalog has archived successfully; discovery may later add more files.",
  "",
  ...rows.map((row) => `- **${row.manufacturer}:** ${bar(row.percent)} ${row.percent}% — ${row.archived}/${row.discovered} archived, ${row.failed} failed`),
  "",
  `- **Overall:** ${bar(overallPercent)} ${overallPercent}% — ${totals.archived}/${totals.discovered} archived, ${totals.failed} failed`,
  "",
].join("\n");

writeFileSync(resolve(process.cwd(), ".checklist-master-archive/STATUS.md"), markdown);
console.log(markdown);
