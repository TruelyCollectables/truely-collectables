import fs from "node:fs";

const file = "src/lib/active-market-competitor-proof-guard.ts";
let source = fs.readFileSync(file, "utf8");

const reconcileBlock = `  const reconciled = reconcileActiveMarketDirectProofs({
    attack,
    targetTitle,
    identity: targetIdentity(targetTitle, tracking, fallbackPlayer),
    proofs,
  });
`;
const typedBlock = `${reconcileBlock}  const reconciledAttack = record(reconciled.attack);
`;
if (!source.includes("const reconciledAttack = record(reconciled.attack);")) {
  if (!source.includes(reconcileBlock)) {
    throw new Error("Could not find direct-proof reconciliation block.");
  }
  source = source.replace(reconcileBlock, typedBlock);
}

source = source
  .replaceAll("list(reconciled.attack.competitors)", "list(reconciledAttack.competitors)")
  .replaceAll("reconciled.attack.taxNote", "reconciledAttack.taxNote")
  .replaceAll("reconciled.attack.marketLocation", "reconciledAttack.marketLocation")
  .replace("    ...reconciled.attack,", "    ...reconciledAttack,");

fs.writeFileSync(file, source);
console.log("Direct-proof reconciled attack type fixed.");
