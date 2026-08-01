import fs from "node:fs";

const learning = fs.readFileSync("src/lib/instacomp-learning-server.ts", "utf8");
const queue = fs.readFileSync(
  "src/app/api/admin/card-listing-queue/route.ts",
  "utf8",
);
const importer = fs.readFileSync(
  "src/app/api/admin/pending-card-import/route.ts",
  "utf8",
);
const gateway = fs.readFileSync(
  "src/app/admin/pending-card-import/TcosListingGateway.tsx",
  "utf8",
);
const gate = fs.readFileSync("src/lib/instacomp-listing-gate.ts", "utf8");
const corrections = fs.readFileSync(
  "src/lib/pending-import-identity-corrections.ts",
  "utf8",
);

const checks = [
  [
    "numbered checklist parallels require a visible serial stamp",
    learning.includes("if (serialRun && !targetSerialRun) continue"),
  ],
  [
    "Cracked Ice aliases to official checklist Ice",
    learning.includes("cracked\\s+ice") && gate.includes("cracked\\s+ice"),
  ],
  [
    "listing writes require checklist confirmation",
    gate.includes("checklist_identity_not_confirmed") &&
      gate.includes("publicListingClaimAllowed"),
  ],
  [
    "high-confidence imported parallel conflicts are blocked",
    gate.includes("parallel_conflicts_with_imported_identity"),
  ],
  [
    "queue leaves unverified scans in needs review without a price",
    queue.includes('status: "needs_review"') &&
      queue.includes("suggestedPrice: null"),
  ],
  [
    "Kiki #149 correction restores Cracked Ice and clears bad price",
    corrections.includes('clientId: "SCAN-0195"') &&
      corrections.includes("Cracked Ice Prizm") &&
      queue.includes("applyKnownPendingImportCorrection"),
  ],
  [
    "future imports preserve immutable original identity",
    importer.includes("originalIdentity: {") &&
      importer.includes("identificationConfidence"),
  ],
  [
    "confidence UI converts 0..1 to percentage",
    gateway.includes("value <= 1 ? value * 100 : value"),
  ],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`Kiki Cracked Ice checklist audit failed ${failed}/${checks.length}.`);
  process.exit(1);
}

console.log(`Kiki Cracked Ice checklist audit passed ${checks.length}/${checks.length}.`);
