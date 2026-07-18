import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const adminRoot = path.join(process.cwd(), "src/app/admin");
const violations = [];

function walk(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) return walk(fullPath);
      if (!stats.isFile() || !fullPath.endsWith(".tsx")) return [];
      return [fullPath];
    });
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function formDepthAt(source, offset) {
  const before = source.slice(0, offset);
  const formTokens = before.match(/<\/?form\b/g) || [];
  return formTokens.reduce((depth, token) => {
    if (token.startsWith("</")) return Math.max(0, depth - 1);
    return depth + 1;
  }, 0);
}

for (const filePath of walk(adminRoot)) {
  const source = readFileSync(filePath, "utf8");
  const relativePath = path.relative(process.cwd(), filePath);
  const alertPattern = /\b(?:window\.)?alert\s*\(/g;
  const promptPattern = /\b(?:window\.)?prompt\s*\(/g;
  const unsafeJsonPattern = /await\s+[\w$.]+\s*\.json\(\)(?!\.catch)/g;
  const buttonPattern = /<button\b[\s\S]*?>/g;
  let match;

  while ((match = alertPattern.exec(source))) {
    violations.push({
      file: relativePath,
      line: lineForOffset(source, match.index),
      message:
        "Admin actions must render inline success/error state instead of using alert().",
    });
  }

  while ((match = promptPattern.exec(source))) {
    violations.push({
      file: relativePath,
      line: lineForOffset(source, match.index),
      message:
        "Admin confirmations and notes must use inline UI instead of prompt().",
    });
  }

  while ((match = unsafeJsonPattern.exec(source))) {
    violations.push({
      file: relativePath,
      line: lineForOffset(source, match.index),
      message:
        "Admin fetch handlers must parse JSON with .catch(() => ({})) so non-JSON failures still show inline feedback.",
    });
  }

  while ((match = buttonPattern.exec(source))) {
    const tag = match[0];
    const line = lineForOffset(source, match.index);
    const insideForm = formDepthAt(source, match.index) > 0;
    const hasType = /\btype\s*=/.test(tag);
    const isSubmitButton = /\btype\s*=\s*["']submit["']/.test(tag);
    const hasAction =
      insideForm ||
      isSubmitButton ||
      /\bonClick\s*=/.test(tag) ||
      /\bformAction\s*=/.test(tag) ||
      /\bonSubmit\s*=/.test(tag);

    if (!hasType) {
      violations.push({
        file: relativePath,
        line,
        message:
          "Admin <button> must declare type=\"button\" or type=\"submit\" explicitly.",
      });
    }

    if (!hasAction) {
      violations.push({
        file: relativePath,
        line,
        message:
          "Admin <button> is outside a form and has no onClick/formAction handler.",
      });
    }
  }
}

if (violations.length) {
  console.error("Admin control check failed:");

  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} ${violation.message}`,
    );
  }

  process.exit(1);
}

console.log("Admin control check passed.");
