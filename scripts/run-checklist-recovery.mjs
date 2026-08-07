import { resolve } from "node:path";

process.env.CHECKLIST_SOURCE = "recovery";
process.env.CHECKLIST_OUTPUT_ROOT = resolve(
  process.cwd(),
  process.env.CHECKLIST_OUTPUT_ROOT || ".checklist-recovery-source-archive/recovery",
);

await import("./recover-missing-checklists.mjs");
