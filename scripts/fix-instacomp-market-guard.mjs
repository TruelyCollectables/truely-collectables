import fs from "node:fs";

const path = "src/lib/instacomp-market-pricing.ts";
let source = fs.readFileSync(path, "utf8");

const guardSearch = `      strategy = "single_active_outlier_guard";
      rawSuggestion = soldQ1;`;
const guardReplacement = `      strategy = "single_active_outlier_guard";
      rawSuggestion = quickSale;`;
if (!source.includes(guardSearch)) {
  throw new Error("Could not find lone-active guard suggestion target.");
}
source = source.replace(guardSearch, guardReplacement);

const ceilingSearch = "  const suggestedPrice = marketEnding(rawSuggestion, activeTarget);";
const ceilingReplacement = `  const competitiveCeiling =
    strategy === "single_active_outlier_guard" ? null : activeTarget;
  const suggestedPrice = marketEnding(rawSuggestion, competitiveCeiling);`;
if (!source.includes(ceilingSearch)) {
  throw new Error("Could not find competitive ceiling target.");
}
source = source.replace(ceilingSearch, ceilingReplacement);

fs.writeFileSync(path, source);
console.log("Fixed the lone-active outlier guard so it cannot become the final price ceiling.");
