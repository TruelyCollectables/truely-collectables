import fs from "node:fs";

const file = "scripts/check-production-guardrails.mjs";
const source = fs.readFileSync(file, "utf8");
const obsolete = '    \'fetch("https://api.resend.com/emails"\',';
const replacement = '    "enqueueAndAttemptOrderNotification",';
const count = source.split(obsolete).length - 1;

if (count === 0) {
  if (source.includes(replacement)) {
    console.log("Shipment notification guard is already modernized.");
    process.exit(0);
  }
  throw new Error("Shipment notification guard contract was not found.");
}

if (count !== 2) {
  throw new Error(`Expected two obsolete shipment email guard entries, found ${count}.`);
}

fs.writeFileSync(file, source.replaceAll(obsolete, replacement));
console.log("Shipment notification guard now requires the queued idempotent notification service.");
