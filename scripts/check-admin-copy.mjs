import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const adminRoot = path.join(root, "src/app/admin");

const disallowedOperatorCopy = [
  "Inventory V2",
  "Simple Inventory",
  "Test Route",
  "V2 linked",
  "V2 item",
  "V2 Bridged",
  "Backfill V2",
  "V2 inventory",
  "· V2",
  "V2:",
  "debug sample",
  "raw result / debug",
  "timeout crap",
  "This is the big button",
  "silently making a mess",
  "real errors",
  "1-click eBay sync",
  "Import ALL active",
];

const violations = [];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) return walk(fullPath);
    if (!stats.isFile() || !fullPath.endsWith(".tsx")) return [];

    return [fullPath];
  });
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

for (const filePath of walk(adminRoot)) {
  const source = readFileSync(filePath, "utf8");

  for (const phrase of disallowedOperatorCopy) {
    let index = source.indexOf(phrase);

    while (index >= 0) {
      violations.push({
        file: path.relative(root, filePath),
        line: lineNumber(source, index),
        phrase,
      });
      index = source.indexOf(phrase, index + phrase.length);
    }
  }
}

if (violations.length > 0) {
  console.error("Admin copy check failed:");

  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} contains "${violation.phrase}"`);
  }

  process.exit(1);
}

console.log("Admin copy check passed.");
