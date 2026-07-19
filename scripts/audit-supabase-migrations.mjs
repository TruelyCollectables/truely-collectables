import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const migrationsDirectory = path.join(repoRoot, "supabase", "migrations");

if (!fs.existsSync(migrationsDirectory)) {
  throw new Error(`Supabase migrations directory not found: ${migrationsDirectory}`);
}

const files = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const versions = new Map();
const malformedNames = [];
const destructiveMatches = [];
const dataMutationFiles = [];

for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) {
    malformedNames.push(file);
    continue;
  }

  const version = match[1];
  const rows = versions.get(version) || [];
  rows.push(file);
  versions.set(version, rows);

  const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
  const destructivePatterns = [
    /\bdrop\s+table\b/i,
    /\btruncate\s+(?:table\s+)?/i,
    /\bdelete\s+from\b/i,
    /\balter\s+table[\s\S]{0,250}\bdrop\s+column\b/i,
  ];

  for (const pattern of destructivePatterns) {
    if (pattern.test(sql)) {
      destructiveMatches.push({ file, pattern: String(pattern) });
    }
  }

  if (/\bupdate\s+(?:public\.)?[a-z0-9_]+\s+set\b/i.test(sql)) {
    dataMutationFiles.push(file);
  }
}

const duplicateVersions = Array.from(versions.entries())
  .filter(([, rows]) => rows.length > 1)
  .map(([version, rows]) => ({ version, files: rows }));

function indexOfFragment(fragment) {
  return files.findIndex((file) => file.includes(fragment));
}

const dependencyChecks = [
  {
    prerequisite: "tcos_market_intel_identity_discovery",
    dependent: "tcos_market_intel_ebay_purchase_inbox",
  },
  {
    prerequisite: "tcos_market_intel_identity_discovery",
    dependent: "tcos_market_intel_market_observations.sql",
  },
  {
    prerequisite: "tcos_market_intel_market_observations.sql",
    dependent: "tcos_market_intel_market_observations_permissions",
  },
];

const dependencyErrors = [];
for (const check of dependencyChecks) {
  const prerequisiteIndex = indexOfFragment(check.prerequisite);
  const dependentIndex = indexOfFragment(check.dependent);
  if (prerequisiteIndex < 0 || dependentIndex < 0) {
    dependencyErrors.push({ ...check, reason: "migration_missing" });
  } else if (prerequisiteIndex >= dependentIndex) {
    dependencyErrors.push({ ...check, reason: "prerequisite_not_before_dependent" });
  }
}

const passed =
  duplicateVersions.length === 0 &&
  malformedNames.length === 0 &&
  destructiveMatches.length === 0 &&
  dependencyErrors.length === 0;

const result = {
  audit: "tcos.supabaseMigrationAudit.v1",
  passed,
  migrationCount: files.length,
  duplicateVersions,
  malformedNames,
  destructiveMatches,
  dataMutationFiles,
  dependencyChecks,
  dependencyErrors,
};

console.log(JSON.stringify(result, null, 2));
if (!passed) process.exitCode = 1;
