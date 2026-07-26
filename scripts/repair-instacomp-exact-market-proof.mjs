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

console.log("Repaired InstaComp exact-market matcher and transform.");