import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(path, text, label) {
  const source = read(path);
  if (!source.includes(text)) {
    throw new Error(`${label}: ${path} is missing ${JSON.stringify(text)}`);
  }
}

const checks = [
  [
    "services/instacomp-ai/app/main.py",
    "INSTACOMP_CHECKLIST_AUDIT",
    "Mac service must emit a per-scan audit log",
  ],
  [
    "services/instacomp-ai/app/main.py",
    '"cardNumberExtracted"',
    "Audit must disclose whether a card number was extracted",
  ],
  [
    "services/instacomp-ai/app/checklist.py",
    "candidate_summaries",
    "Registry gateway must preserve candidate variants",
  ],
  [
    "services/instacomp-ai/app/checklist.py",
    "checklist-coverage",
    "Health must perform a real authenticated Registry coverage probe",
  ],
  [
    "services/instacomp-ai/app/printed_evidence.py",
    "Many Bowman/Topps backs print a prefixed key",
    "Unlabelled prefixed card numbers must be recognized",
  ],
  [
    "src/app/api/instacomp/checklist-coverage/route.ts",
    'lookupScope: "all active/live checklist versions and their card rows"',
    "Coverage endpoint must state its exact lookup scope",
  ],
  [
    "src/app/api/account/seller/inventory/instacomp-front-back/route.ts",
    "checklistAudit: record(ai.internalChecklistAudit)",
    "Pending cards must persist the Mac receipt",
  ],
  [
    "src/app/api/account/seller/inventory/instacomp-job-status/route.ts",
    "checklistAudit: record(instaComp.checklistAudit)",
    "Reloaded job status must return the receipt",
  ],
  [
    "src/app/kingmaker/pending/page.tsx",
    "Checklist Audit — prove what InstaComp actually accessed",
    "Pending UI must show a readable audit panel",
  ],
  [
    "src/app/api/instacomp/internal-readiness/route.ts",
    "checklistActiveLiveCards",
    "Readiness must report actual accessible checklist rows",
  ],
];

for (const [path, text, label] of checks) {
  requireText(path, text, label);
}

const page = read("src/app/kingmaker/pending/page.tsx");
for (const label of [
  "OCR ran:",
  "Card number:",
  "Registry called:",
  "Registry reachable:",
  "Candidates found:",
  "Parallel candidates:",
  "Surface/pattern evidence:",
]) {
  if (!page.includes(label)) {
    throw new Error(`Checklist audit panel is missing ${label}`);
  }
}

console.log("InstaComp checklist audit architecture gate passed.");
