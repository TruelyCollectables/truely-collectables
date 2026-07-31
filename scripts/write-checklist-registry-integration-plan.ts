import { readFile, writeFile } from "node:fs/promises";
import { paniniStructuredChecklistAdapter } from "../src/lib/checklist-registry/panini-structured";

const fixturePath =
  "scripts/fixtures/checklist-registry/2025-panini-select-wnba.structured.json";
const outputPath =
  process.argv[2] || ".codex-run/checklist-registry-integration-plan.json";
const content = await readFile(fixturePath);
const plan = paniniStructuredChecklistAdapter.parse({
  sourceUrl:
    "https://www.paniniamerica.net/2025-panini-select-wnba-official-checklist",
  originalFilename: "2025-panini-select-wnba.structured.json",
  mimeType: "application/json",
  content: new Uint8Array(content),
  retrievedAt: "2026-07-31T22:45:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
});

if (plan.validation.status !== "passed") {
  throw new Error(
    `Integration plan did not validate: ${JSON.stringify(plan.validation.issues)}`,
  );
}

await writeFile(outputPath, JSON.stringify(plan), "utf8");
console.log(
  JSON.stringify({
    ok: true,
    outputPath,
    counts: plan.validation.counts,
    sha256: plan.source.storage.sha256,
  }),
);
