import { spawnSync } from "node:child_process";

const scope = process.env.VERCEL_SCOPE || "truelycollectables-projects";
const cleanDomain =
  process.env.VERCEL_CLEAN_DOMAIN || "truely-collectables.vercel.app";
const unwantedAlias =
  process.env.VERCEL_UNWANTED_ALIAS || "truely-collectables-tt3b.vercel.app";
const deploymentPattern =
  /https:\/\/truely-collectables-[a-z0-9]+-truelycollectables-projects\.vercel\.app/;

function optionalRun(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) return "";

  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (options.print !== false) {
    process.stdout.write(output);
  }

  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}.\n${output}`,
    );
  }

  return output;
}

function gitPreflight() {
  const status = optionalRun("git", ["status", "--short"]);
  const localHead = optionalRun("git", ["rev-parse", "HEAD"]);
  const remoteHead = optionalRun("git", ["rev-parse", "origin/main"]);

  console.log("Git preflight:");
  console.log(`- local HEAD: ${localHead || "unknown"}`);
  console.log(`- origin/main: ${remoteHead || "unknown"}`);

  if (status) {
    console.log("- working tree has local changes:");
    console.log(status);
  } else {
    console.log("- working tree is clean");
  }

  if (localHead && remoteHead && localHead !== remoteHead) {
    throw new Error(
      "Local HEAD does not match origin/main. Run git push before deploying.",
    );
  }
}

gitPreflight();
console.log(`Deploying production with Vercel scope ${scope}...`);

const deployOutput = run("vercel", ["--prod", "--yes", "--scope", scope], {
  allowFailure: true,
});

if (deployOutput.includes("api-deployments-free-per-day")) {
  throw new Error(
    "Vercel deployment quota is still capped (api-deployments-free-per-day). Wait for the rolling 24-hour quota to reset, then rerun npm run launch:production.",
  );
}

const deploymentUrl = deployOutput.match(deploymentPattern)?.[0];

if (!deploymentUrl) {
  throw new Error(
    `Could not parse Vercel deployment URL. If quota is capped, wait and retry.\n${deployOutput}`,
  );
}

console.log(`Parsed deployment URL: ${deploymentUrl}`);
console.log(`Removing unwanted alias if present: ${unwantedAlias}`);
run(
  "vercel",
  ["alias", "rm", unwantedAlias, "--yes", "--scope", scope],
  { allowFailure: true },
);

console.log(`Pointing ${cleanDomain} at ${deploymentUrl}`);
run("vercel", ["alias", "set", deploymentUrl, cleanDomain, "--scope", scope]);

console.log("");
console.log(`DEPLOYED_PRODUCTION=${deploymentUrl}`);
console.log(`CLEAN_PRODUCTION=https://${cleanDomain}`);
console.log("");
console.log("Next verification command if you ran deploy without the one-shot launch:");
console.log("npm run smoke:production");
