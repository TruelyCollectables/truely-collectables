import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Manifest = { totals?: { requested?: number; archived?: number; failed?: number } };
type DiscoveryRow = {
  manufacturer: string;
  pagesScanned: number;
  pagesRemaining: number;
  pageLimit: number;
  catalogScanComplete: boolean;
  newlyDiscovered: number;
  discoveredTotal: number;
  pageFailures: unknown[];
};

type ManufacturerConfig = { name: string; manifestPath: string };
const manufacturers: ManufacturerConfig[] = [
  { name: "Topps", manifestPath: ".topps-seed-archive/manifest.json" },
  { name: "Panini", manifestPath: ".panini-seed-archive/manifest.json" },
  { name: "Leaf", manifestPath: ".leaf-checklist-archive/manifest.json" },
];

function bar(percent: number, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

const discoveryPath = resolve(process.cwd(), ".checklist-discovery/report.json");
const discoveryRows: DiscoveryRow[] = existsSync(discoveryPath)
  ? JSON.parse(readFileSync(discoveryPath, "utf8")).manufacturers || []
  : [];

const rows = manufacturers.map(({ name, manifestPath }) => {
  const discovery = discoveryRows.find((row) => row.manufacturer === name);
  const absolute = resolve(process.cwd(), manifestPath);
  const manifest: Manifest = existsSync(absolute) ? JSON.parse(readFileSync(absolute, "utf8")) : {};
  const discovered = Number(manifest.totals?.requested ?? discovery?.discoveredTotal ?? 0);
  const archived = Number(manifest.totals?.archived ?? 0);
  const failed = Number(manifest.totals?.failed ?? 0);
  const queued = Math.max(0, discovered - archived - failed);
  const downloadPercent = discovered > 0 ? Math.round((archived / discovered) * 100) : 0;
  const scanComplete = Boolean(discovery?.catalogScanComplete);
  const discoveryPercent = scanComplete
    ? 100
    : Math.min(99, Math.round(((discovery?.pagesScanned ?? 0) / Math.max(1, (discovery?.pagesScanned ?? 0) + (discovery?.pagesRemaining ?? 0))) * 100));
  const caughtUp = scanComplete && failed === 0 && queued === 0 && archived === discovered && discovered > 0;
  return {
    manufacturer: name,
    catalogPagesScanned: discovery?.pagesScanned ?? 0,
    catalogPagesRemaining: discovery?.pagesRemaining ?? 0,
    catalogScanComplete: scanComplete,
    discoveryPercent,
    newlyDiscovered: discovery?.newlyDiscovered ?? 0,
    discovered,
    archived,
    failed,
    queued,
    downloadPercent,
    status: caughtUp ? "caught-up" : scanComplete ? "downloading-or-repairing" : "discovering",
  };
});

const totals = rows.reduce(
  (sum, row) => ({ discovered: sum.discovered + row.discovered, archived: sum.archived + row.archived, failed: sum.failed + row.failed, queued: sum.queued + row.queued, newlyDiscovered: sum.newlyDiscovered + row.newlyDiscovered }),
  { discovered: 0, archived: 0, failed: 0, queued: 0, newlyDiscovered: 0 },
);
const overallPercent = totals.discovered > 0 ? Math.round((totals.archived / totals.discovered) * 100) : 0;
const allCaughtUp = rows.every((row) => row.status === "caught-up");
const generatedAt = new Date().toISOString();
const report = {
  schema: "tcos.checklistMasterArchiveStatus.v2",
  generatedAt,
  completionRule: "Caught up requires a completed official catalog scan, zero failures, zero queued files, and every discovered checklist archived.",
  allCaughtUp,
  totals: { ...totals, downloadPercent: overallPercent },
  manufacturers: rows,
};

mkdirSync(resolve(process.cwd(), ".checklist-master-archive"), { recursive: true });
writeFileSync(resolve(process.cwd(), ".checklist-master-archive/status.json"), JSON.stringify(report, null, 2) + "\n");

const markdown = [
  "# Master Checklist Archive Status",
  "",
  `Generated: ${generatedAt}`,
  "",
  "> A manufacturer is done only after its official catalog crawl is exhausted and every discovered checklist has archived successfully.",
  "",
  ...rows.flatMap((row) => [
    `## ${row.manufacturer} — ${row.status}`,
    `- Discovery: ${bar(row.discoveryPercent)} ${row.discoveryPercent}% — ${row.catalogPagesScanned} pages scanned, ${row.catalogPagesRemaining} pages still queued, ${row.newlyDiscovered} new files found this run`,
    `- Downloads: ${bar(row.downloadPercent)} ${row.downloadPercent}% — ${row.archived}/${row.discovered} archived, ${row.queued} queued, ${row.failed} failed`,
    "",
  ]),
  `## Overall — ${allCaughtUp ? "CAUGHT UP" : "WORKING"}`,
  `- Downloads: ${bar(overallPercent)} ${overallPercent}% — ${totals.archived}/${totals.discovered} archived, ${totals.queued} queued, ${totals.failed} failed, ${totals.newlyDiscovered} newly discovered`,
  "",
].join("\n");
writeFileSync(resolve(process.cwd(), ".checklist-master-archive/STATUS.md"), markdown);
console.log(markdown);
