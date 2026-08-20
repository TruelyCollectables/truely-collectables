import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseUpperDeckOfficialHtmlChecklist } from "../src/lib/checklist-registry/upper-deck-official-html";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const sourceUrl = process.env.HOCKEY_RECOVERY_URL || "https://upperdeck.com/checklist/2022-23-ice-checklist/";
const output = process.env.HOCKEY_RECOVERY_OUTPUT || ".hockey-recovery/ice-2022-23-plan.json";

function normalizeCommaSerialCells(html: string) {
  // Upper Deck publishes serial runs such as 1,299 in otherwise numeric table cells.
  // Normalize only complete numeric cell contents so player/set punctuation is untouched.
  return html.replace(/(<td\b[^>]*>\s*)(\d{1,3}(?:,\d{3})+)(\s*<\/td>)/gi, (_m, before, digits, after) =>
    `${before}${String(digits).replace(/,/g, "")}${after}`,
  );
}

const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "TCOS-Checklist-Recovery/1.0" },
  signal: AbortSignal.timeout(75_000),
});
if (!response.ok) throw new Error(`Could not fetch ${sourceUrl}: HTTP ${response.status}`);
const originalHtml = await response.text();
if (originalHtml.length < 1_000) throw new Error("Upper Deck recovery HTML is incomplete.");

const normalizedHtml = normalizeCommaSerialCells(originalHtml);
const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1) || "checklist";
const artifact: ChecklistSourceArtifact = {
  sourceUrl,
  originalFilename: `${slug}.html`,
  mimeType: "text/html",
  content: normalizedHtml,
  retrievedAt: new Date().toISOString(),
  authority: "official_manufacturer",
  redistributionAllowed: false,
};

const plan = parseUpperDeckOfficialHtmlChecklist(artifact);
const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
if (errors.length) {
  throw new Error(`Recovery plan still has ${errors.length} validation errors: ${JSON.stringify(errors.slice(0, 10))}`);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ sourceUrl, plan }, null, 2));
console.log(JSON.stringify({
  ok: true,
  sourceUrl,
  adapterId: plan.adapterId,
  adapterVersion: plan.adapterVersion,
  counts: plan.validation.counts,
  warnings: plan.validation.issues.length,
  output,
}));
