import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function argumentValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
}

function run(script: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, ...args],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return false;
  }
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const positional = args[0];
  const bundleDirectory = resolve(
    positional && !positional.startsWith("--")
      ? positional
      : ".codex-run/tcgdex-ja-registry-bundles",
  );
  const receipt = resolve(
    argumentValue(args, "--receipt") ||
      ".codex-run/pokemon-ja-official-verification-receipt.json",
  );
  const queue = resolve(
    argumentValue(args, "--queue") ||
      ".codex-run/pokemon-ja-official-discrepancy-queue.json",
  );

  if (
    !run(
      "scripts/verify-pokemon-japanese-official-sources.ts",
      args,
    )
  ) {
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    return;
  }

  if (
    !run(
      "scripts/finalize-pokemon-japanese-official-verification.ts",
      [
        bundleDirectory,
        "--receipt",
        receipt,
        "--queue",
        queue,
      ],
    )
  ) {
    return;
  }

  run(
    "scripts/quarantine-pokemon-japanese-reused-products.ts",
    [
      "--receipt",
      receipt,
      "--queue",
      queue,
    ],
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.stack || error.message : error,
  );
  process.exitCode = 1;
}
