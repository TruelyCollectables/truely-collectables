import fs from "node:fs";

const file = "src/app/seller/inventory/SellerActiveInventoryPricing.tsx";
let source = fs.readFileSync(file, "utf8");

const importLine =
  'import ActiveMarketEvidenceLedger from "./ActiveMarketEvidenceLedger";';
if (!source.includes(importLine)) {
  const anchor =
    'import { getFreshAccountSession } from "../../account/account-session";';
  if (!source.includes(anchor)) {
    throw new Error("Could not find the Seller Inventory import anchor.");
  }
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const renderLine = "      <ActiveMarketEvidenceLedger attack={attack} />";
if (!source.includes(renderLine)) {
  const anchor = `      <p className="mt-3 text-xs font-semibold">\n        {attack.taxNote ||`;
  if (!source.includes(anchor)) {
    throw new Error("Could not find the Active Market board diagnostic anchor.");
  }
  source = source.replace(anchor, `${renderLine}\n\n${anchor}`);
}

fs.writeFileSync(file, source);
console.log("Seller Active Market evidence ledger UI applied.");
