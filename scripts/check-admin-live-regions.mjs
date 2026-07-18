import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const adminRoot = path.join(root, "src/app/admin");
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
  const relativePath = path.relative(root, filePath);
  const tagPattern = /<[A-Za-z][A-Za-z0-9.:-]*(?:\s|>)[\s\S]*?>/g;
  let match;

  while ((match = tagPattern.exec(source))) {
    const tag = match[0];

    if (!/\baria-live\s*=/.test(tag)) continue;

    if (!/\brole\s*=/.test(tag)) {
      violations.push({
        file: relativePath,
        line: lineNumber(source, match.index),
        tag: tag.split("\n")[0].slice(0, 80),
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Admin live-region check failed:");

  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} uses aria-live without an explicit role (${violation.tag}).`,
    );
  }

  process.exit(1);
}

console.log("Admin live-region check passed.");
