import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_WORKER_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
];

const WORKER_DEFAULTS = {
  MARKET_INTEL_WORKER_NAME: "mac-private-worker",
  MARKET_INTEL_WORKER_MAX_SUBJECTS: "3",
  MARKET_INTEL_WORKER_MAX_IDENTITIES: "4",
  MARKET_INTEL_WORKER_MAX_QUERIES: "8",
  MARKET_INTEL_WORKER_RESULTS_PER_QUERY: "5",
  MARKET_INTEL_WORKER_MINIMUM_CONFIDENCE: "55",
  MARKET_INTEL_WORKER_INTERVAL_MINUTES: "15",
};

export function parseDotEnv(contents) {
  const values = new Map();
  const normalizedContents = String(contents || "").replace(/^\uFEFF/, "");

  for (const rawLine of normalizedContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const name = match[1];
    let rawValue = match[2].trim();
    let value = rawValue;

    if (rawValue.startsWith("\"") && rawValue.endsWith("\"")) {
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue.slice(1, -1);
      }
    } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      value = rawValue.slice(1, -1);
    } else {
      const commentMatch = rawValue.match(/^(.*?)(?:\s+#.*)?$/);
      value = (commentMatch?.[1] || rawValue).trim();
    }

    values.set(name, String(value).replace(/\r$/, ""));
  }

  return values;
}

export function readDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  return parseDotEnv(fs.readFileSync(filePath, "utf8"));
}

export function encodeDotEnvValue(value) {
  const text = String(value ?? "");
  if (/[\0\r\n]/.test(text)) {
    throw new Error("Worker environment values cannot contain null bytes or line breaks.");
  }
  return JSON.stringify(text);
}

export function writeWorkerEnvFile(filePath, values) {
  const orderedNames = [
    ...REQUIRED_WORKER_ENV_NAMES,
    "SUPABASE_PROJECT_REF",
    ...Object.keys(WORKER_DEFAULTS),
  ];
  const lines = [];

  for (const name of orderedNames) {
    const value = values.get(name);
    if (value === undefined || value === null || String(value).trim() === "") continue;
    lines.push(`${name}=${encodeDotEnvValue(value)}`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function prepareWorkerEnv({ targetPath, sourcePaths, intervalMinutes }) {
  const values = new Map();
  const sourcesUsed = [];

  for (const sourcePath of sourcePaths) {
    if (!fs.existsSync(sourcePath)) continue;
    sourcesUsed.push(sourcePath);
    for (const [name, value] of readDotEnvFile(sourcePath)) {
      values.set(name, value);
    }
  }

  for (const name of [...REQUIRED_WORKER_ENV_NAMES, "SUPABASE_PROJECT_REF"]) {
    const processValue = process.env[name];
    if (processValue?.trim()) values.set(name, processValue.trim());
  }

  for (const [name, defaultValue] of Object.entries(WORKER_DEFAULTS)) {
    if (!String(values.get(name) || "").trim()) values.set(name, defaultValue);
  }
  values.set("MARKET_INTEL_WORKER_INTERVAL_MINUTES", String(intervalMinutes));

  const missing = REQUIRED_WORKER_ENV_NAMES.filter(
    (name) => !String(values.get(name) || "").trim(),
  );
  if (missing.length) {
    const sourceSummary = sourcesUsed.length
      ? sourcesUsed.map((source) => `  ${source}`).join("\n")
      : "  none found";
    throw new Error(
      `Worker activation is missing required settings:\n  ${missing.join("\n  ")}\nChecked ignored local env files:\n${sourceSummary}\nNo credential values were displayed.`,
    );
  }

  writeWorkerEnvFile(targetPath, values);
  return {
    targetPath,
    sourcesUsed,
    requiredSettingsPresent: true,
    intervalMinutes,
  };
}

function argumentValues(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(path.resolve(process.argv[index + 1]));
      index += 1;
    }
  }
  return values;
}

function argumentValue(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDirectory, "..");
  const targetPath = path.resolve(
    argumentValue("--target", path.join(repoRoot, ".env.market-intel-worker.local")),
  );
  const sourcePaths = argumentValues("--source");
  const intervalMinutes = Math.max(
    5,
    Math.min(1440, Math.round(Number(argumentValue("--minutes", "15")) || 15)),
  );

  const result = prepareWorkerEnv({ targetPath, sourcePaths, intervalMinutes });
  console.log(
    JSON.stringify(
      {
        prepared: true,
        targetPath: result.targetPath,
        sourceFilesRead: result.sourcesUsed.length,
        requiredSettingsPresent: true,
        credentialsDisplayed: false,
        intervalMinutes: result.intervalMinutes,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 78;
  });
}
