import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readDotEnvFile } from "./prepare-market-intel-worker-env.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const explicitEnvFile = String(
  process.env.MARKET_INTEL_WORKER_ENV_FILE || "",
).trim();
const envFile = path.resolve(
  explicitEnvFile || path.join(repoRoot, ".env.market-intel-worker.local"),
);
const targetArgument = String(process.argv[2] || "").trim();
const exportName = String(process.argv[3] || "").trim();

if (!targetArgument) {
  throw new Error(
    "Worker launcher requires a target module path, such as scripts/run-market-intel-external-worker.ts.",
  );
}

if (fs.existsSync(envFile)) {
  for (const [name, value] of readDotEnvFile(envFile)) {
    if (!String(process.env[name] || "").trim()) {
      process.env[name] = value;
    }
  }
} else if (explicitEnvFile) {
  throw new Error(`Market Intel worker environment file was not found: ${envFile}`);
}

const targetPath = path.isAbsolute(targetArgument)
  ? targetArgument
  : path.resolve(repoRoot, targetArgument);
const loadedModule = await import(pathToFileURL(targetPath).href);

if (exportName) {
  const exportedFunction = loadedModule[exportName];
  if (typeof exportedFunction !== "function") {
    throw new Error(
      `Target module ${targetArgument} does not export function ${exportName}.`,
    );
  }

  const result = await exportedFunction();
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
  }
}
