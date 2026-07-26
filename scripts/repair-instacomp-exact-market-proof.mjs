import fs from "node:fs";

function replaceRequired(source, before, after, file) {
  if (!source.includes(before)) {
    throw new Error(`${file}: required repair marker not found: ${before.slice(0, 100)}`);
  }
  return source.replace(before, () => after);
}

{
  const file = "src/lib/instacomp.ts";
  let source = fs.readFileSync(file, "utf8");

  source = replaceRequired(
    source,
    `if (containsAny(t, [" relic", " patch", " jersey", " memorabilia"])) {`,
    `if (containsAny(t, [" relic", " patch", " jersey", " memorabilia", " swatch", " material"])) {`,
    file,
  );

  source = replaceRequired(
    source,
    `containsAny(\` \${t} \`, [" relic ", " patch ", " jersey ", " memorabilia "])`,
    `containsAny(\` \${t} \`, [" relic ", " patch ", " jersey ", " memorabilia ", " swatch ", " swatches ", " material ", " materials "])`,
    file,
  );

  fs.writeFileSync(file, source);
}

{
  const file = "src/lib/instacomp-ebay-serp-provider.ts";
  let source = fs.readFileSync(file, "utf8");

  source = replaceRequired(
    source,
    `function escapeRegExp(value: string) {\n  return value.replace(/[|\\{}()[\\]^$+*?.-]/g, "\\\\function deterministicExactTitle");\n}`,
    `function escapeRegExp(value: string) {\n  const special = "\\\\^$.*+?()[]{}|";\n  return value\n    .split("")\n    .map((character) => special.includes(character) ? \`\\\\\${character}\` : character)\n    .join("");\n}`,
    file,
  );

  source = replaceRequired(
    source,
    `  const distinctiveParallelTokens = normalizedWords(String(ai.parallel || "")).filter(\n    (token) => !["prizm", "refractor", "parallel", "foil", "holo"].includes(token),\n  );`,
    `  const distinctiveParallelTokens = normalizedWords(\n    normalizeInstaCompParallelForExactMatching(ai.parallel),\n  ).filter(\n    (token) => !["prizm", "refractor", "parallel", "foil", "holo"].includes(token),\n  );`,
    file,
  );

  source = replaceRequired(
    source,
    `  const targetDenominator = titleSerialDenominator(ai.serialNumber);\n  if (targetDenominator && titleSerialDenominator(title) !== targetDenominator) return false;`,
    `  const targetDenominator = titleSerialDenominator(ai.serialNumber);\n  const candidateDenominator = titleSerialDenominator(title);\n  if (targetDenominator) {\n    if (candidateDenominator !== targetDenominator) return false;\n  } else if (candidateDenominator !== null) {\n    return false;\n  }`,
    file,
  );

  source = replaceRequired(
    source,
    `  if (ai.gradingCompany) {\n    const grader = compactIdentity(ai.gradingCompany);\n    if (grader && !titleCompact.includes(grader)) return false;\n  }\n  if (ai.gradeValue) {\n    const grade = compactIdentity(String(ai.gradeValue));\n    if (grade && !titleCompact.includes(grade)) return false;\n  }`,
    `  if (ai.gradingCompany && !flags.includes("grader")) return false;\n  if (ai.gradeValue && !flags.includes("grade")) return false;\n  if (ai.isAuto && !flags.includes("autograph")) return false;\n  if (ai.isRelic && !flags.includes("relic")) return false;`,
    file,
  );

  fs.writeFileSync(file, source);
}

{
  const file = "src/app/api/account/seller/inventory/instacomp-universal/route.ts";
  let source = fs.readFileSync(file, "utf8");
  source = replaceRequired(
    source,
    `    const suggestedPrice = pricingAnalysis.suggestedPrice;\n    const reliableSoldCompCount = pricingAnalysis.soldCount;\n    const hasReliableSoldComps = pricingAnalysis.soldCount > 0;\n    const pricingStatus = suggestedPrice > 0\n      ? "suggested_from_reliable_sold_comps"\n      : "seller_price_required";\n    const pricingReason = pricingAnalysis.explanation;`,
    `    const reliableSoldCompCount = pricingAnalysis.soldCount;\n    const hasReliableSoldComps = reliableSoldCompCount > 0;\n    const suggestedPrice = hasReliableSoldComps ? pricingAnalysis.suggestedPrice : 0;\n    const pricingStatus = hasReliableSoldComps && suggestedPrice > 0\n      ? "suggested_from_reliable_sold_comps"\n      : "seller_price_required";\n    const pricingReason = hasReliableSoldComps\n      ? pricingAnalysis.explanation\n      : activeCompetition.length\n        ? `No exact sold listing passed. \${activeCompetition.length} exact active listing\${activeCompetition.length === 1 ? " is" : "s are"} shown only as current competition; seller pricing is required.`\n        : "No exact sold or active listing passed; seller pricing is required.";`,
    file,
  );
  fs.writeFileSync(file, source);
}

{
  const file = "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts";
  let source = fs.readFileSync(file, "utf8");
  source = replaceRequired(
    source,
    `    const suggestedPrice = pricingAnalysis.suggestedPrice;\n    const hasReliableSoldComps = pricingAnalysis.soldCount > 0;\n    const pricingStatus = suggestedPrice > 0\n      ? "suggested_from_reliable_sold_comps"\n      : "seller_price_required";`,
    `    const hasReliableSoldComps = pricingAnalysis.soldCount > 0;\n    const suggestedPrice = hasReliableSoldComps ? pricingAnalysis.suggestedPrice : 0;\n    const pricingStatus = hasReliableSoldComps && suggestedPrice > 0\n      ? "suggested_from_reliable_sold_comps"\n      : "seller_price_required";`,
    file,
  );
  source = replaceRequired(
    source,
    `        pricingReason: pricingAnalysis.explanation,`,
    `        pricingReason: hasReliableSoldComps\n          ? pricingAnalysis.explanation\n          : nextActive.length\n            ? `No exact sold listing remains. \${nextActive.length} exact active listing\${nextActive.length === 1 ? " is" : "s are"} shown only as competition; seller pricing is required.`\n            : "No exact sold or active listing remains; seller pricing is required.",`,
    file,
  );
  fs.writeFileSync(file, source);
}

console.log("Repaired InstaComp exact-market matcher, transform, and sold-only pricing trust.");