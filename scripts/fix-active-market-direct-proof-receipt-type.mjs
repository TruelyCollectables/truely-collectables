import fs from "node:fs";

const file = "src/lib/active-market-competitor-proof-guard.ts";
let source = fs.readFileSync(file, "utf8");
const oldBlock = `    verified: list(reconciled.attack.competitors).map((candidate) => ({
      itemId: canonicalActiveMarketProofItemId(candidate),
      price: candidate.price,
      shippingCost: candidate.shippingCost,
      landedPrice: candidate.landedPrice,
    })),`;
const newBlock = `    verified: list(reconciled.attack.competitors).map((value) => {
      const candidate = record(value);
      return {
        itemId: canonicalActiveMarketProofItemId(candidate),
        price: candidate.price,
        shippingCost: candidate.shippingCost,
        landedPrice: candidate.landedPrice,
      };
    }),`;

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) {
    throw new Error("Could not find direct-proof receipt serializer.");
  }
  source = source.replace(oldBlock, newBlock);
}

fs.writeFileSync(file, source);
console.log("Direct-proof receipt serializer type fixed.");
