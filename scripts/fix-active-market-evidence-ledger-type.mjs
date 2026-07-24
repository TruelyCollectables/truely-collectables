import fs from "node:fs";

const file = "src/app/seller/inventory/ActiveMarketEvidenceLedger.tsx";
let source = fs.readFileSync(file, "utf8");
const anchor = "type ActiveMarketAttackEvidence = {\n";
const replacement = "type ActiveMarketAttackEvidence = {\n  [key: string]: unknown;\n";

if (!source.includes(replacement)) {
  if (!source.includes(anchor)) {
    throw new Error("Could not find the Active Market evidence prop type.");
  }
  source = source.replace(anchor, replacement);
}

fs.writeFileSync(file, source);
console.log("Active Market evidence ledger prop type widened safely.");
