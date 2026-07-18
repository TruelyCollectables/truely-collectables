import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const appRoot = path.join(root, "src/app");
const adminRoot = path.join(appRoot, "admin");
const checkedRoots = [adminRoot];
const routePatterns = [];
const violations = [];
const fetchViolations = [];
const segmentConfigReexportViolations = [];
const routeSegmentConfigNames = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);

function walk(dir, matcher) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) return walk(fullPath, matcher);
    if (!stats.isFile()) return [];
    return matcher(fullPath) ? [fullPath] : [];
  });
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function normalizeRoute(routePath) {
  return routePath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function routePatternFromFile(filePath) {
  const relative = path.relative(appRoot, filePath);
  const parts = relative.split(path.sep);
  const fileName = parts.pop();

  if (fileName !== "page.tsx" && fileName !== "route.ts") return null;

  return normalizeRoute(
    "/" +
      parts
        .map((part) =>
          part.startsWith("[") && part.endsWith("]") ? "*" : part,
        )
        .join("/"),
  );
}

for (const filePath of walk(appRoot, (file) =>
  file.endsWith("page.tsx") || file.endsWith("route.ts"),
)) {
  const pattern = routePatternFromFile(filePath);

  if (pattern) {
    routePatterns.push({
      filePath,
      pattern,
    });
  }
}

function matchedRoute(referencePath) {
  const referenceParts = normalizeRoute(referencePath).split("/").filter(Boolean);

  return routePatterns.find(({ pattern }) => {
    const patternParts = pattern.split("/").filter(Boolean);
    if (patternParts.length !== referenceParts.length) return false;

    return patternParts.every(
      (part, index) => part === "*" || part === referenceParts[index],
    );
  });
}

function pathMatchesRoute(referencePath) {
  return Boolean(matchedRoute(referencePath));
}

function extractInternalReferences(source) {
  const references = [];
  const literalPattern = /(["'`])((?:\/admin|\/api)[^"'`]*)\1/g;
  let match;

  while ((match = literalPattern.exec(source))) {
    let rawPath = match[2];
    rawPath = rawPath.replace(/\$\{[^}]+\}/g, "*");
    const [withoutQuery] = rawPath.split(/[?#]/);
    references.push({
      path: normalizeRoute(withoutQuery),
      offset: match.index,
    });
  }

  return references;
}

function extractFetchReferences(source) {
  const references = [];
  const fetchPattern = /fetch\(\s*(["'`])((?:\/admin|\/api)[^"'`]*)\1/g;
  let match;

  while ((match = fetchPattern.exec(source))) {
    let rawPath = match[2];
    rawPath = rawPath.replace(/\$\{[^}]+\}/g, "*");
    const [withoutQuery] = rawPath.split(/[?#]/);
    references.push({
      path: normalizeRoute(withoutQuery),
      offset: match.index,
    });
  }

  return references;
}

function exportedNameForSpecifier(specifier) {
  const trimmed = specifier.trim();
  if (!trimmed) return null;

  const aliasMatch = trimmed.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
  if (aliasMatch) return aliasMatch[1];

  const localMatch = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
  return localMatch ? localMatch[1] : null;
}

function extractSegmentConfigReexports(source) {
  const references = [];
  const namedReexportPattern = /export\s*\{([^}]+)\}\s*from\s*(["'][^"']+["'])/g;
  const starReexportPattern = /export\s+\*\s+from\s*(["'][^"']+["'])/g;
  let match;

  while ((match = namedReexportPattern.exec(source))) {
    const names = match[1].split(",").map(exportedNameForSpecifier);
    const configNames = names.filter((name) => routeSegmentConfigNames.has(name));

    if (configNames.length > 0) {
      references.push({
        configNames,
        offset: match.index,
      });
    }
  }

  while ((match = starReexportPattern.exec(source))) {
    references.push({
      configNames: ["*"],
      offset: match.index,
    });
  }

  return references;
}

const routeSourceCache = new Map();

function routeSource(filePath) {
  if (!routeSourceCache.has(filePath)) {
    routeSourceCache.set(filePath, readFileSync(filePath, "utf8"));
  }

  return routeSourceCache.get(filePath);
}

for (const sourceRoot of checkedRoots) {
  for (const filePath of walk(sourceRoot, (file) => file.endsWith(".tsx") || file.endsWith(".ts"))) {
    const source = readFileSync(filePath, "utf8");
    const relativePath = path.relative(root, filePath);
    const isRouteSegmentFile =
      filePath.endsWith(`${path.sep}page.tsx`) ||
      filePath.endsWith(`${path.sep}layout.tsx`) ||
      filePath.endsWith(`${path.sep}route.ts`);

    if (isRouteSegmentFile) {
      for (const reference of extractSegmentConfigReexports(source)) {
        segmentConfigReexportViolations.push({
          file: relativePath,
          line: lineForOffset(source, reference.offset),
          configNames: reference.configNames,
        });
      }
    }

    for (const reference of extractInternalReferences(source)) {
      if (!pathMatchesRoute(reference.path)) {
        violations.push({
          file: relativePath,
          line: lineForOffset(source, reference.offset),
          path: reference.path,
        });
      }
    }

    for (const reference of extractFetchReferences(source)) {
      const route = matchedRoute(reference.path);

      if (!route) continue;

      const routeSourceText = routeSource(route.filePath);

      if (/\bNextResponse\.redirect\b|\bredirect\(/.test(routeSourceText)) {
        fetchViolations.push({
          file: relativePath,
          line: lineForOffset(source, reference.offset),
          path: reference.path,
          route: path.relative(root, route.filePath),
        });
      }
    }
  }
}

if (segmentConfigReexportViolations.length) {
  console.error("Admin route segment config check failed:");

  for (const violation of segmentConfigReexportViolations) {
    const names =
      violation.configNames[0] === "*"
        ? "star re-export"
        : violation.configNames.join(", ");

    console.error(
      `- ${violation.file}:${violation.line} re-exports route segment config (${names}); export config directly from the route segment file instead.`,
    );
  }

  process.exit(1);
}

if (violations.length) {
  console.error("Admin route check failed:");

  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.path}`);
  }

  process.exit(1);
}

if (fetchViolations.length) {
  console.error("Admin fetch route check failed:");

  for (const violation of fetchViolations) {
    console.error(
      `- ${violation.file}:${violation.line} fetches ${violation.path}, but ${violation.route} can redirect`,
    );
  }

  process.exit(1);
}

console.log("Admin route check passed.");
