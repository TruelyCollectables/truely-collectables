import fs from "node:fs";

const deployPath = "scripts/deploy-production.mjs";
const source = fs.readFileSync(deployPath, "utf8");

const functionBefore = `  if (localHead && remoteHead && localHead !== remoteHead) {
    throw new Error(
      "Local HEAD does not match origin/main. Run git push before deploying.",
    );
  }
}

if (redactionSelfTest) {`;
const functionAfter = `  if (localHead && remoteHead && localHead !== remoteHead) {
    throw new Error(
      "Local HEAD does not match origin/main. Run git push before deploying.",
    );
  }
}

function productionEnvironmentPreflight() {
  const auditScript = path.resolve(
    process.cwd(),
    "scripts/audit-vercel-production-environment.mjs",
  );

  if (!fs.existsSync(auditScript)) {
    throw new Error(
      "Required Vercel Production environment audit script is missing. No deployment was started.",
    );
  }

  console.log(
    "Auditing required Vercel Production environment variable names before deployment preflight...",
  );
  const result = spawnSync(process.execPath, [auditScript], {
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      VERCEL_SCOPE: scope,
    },
  });
  const output = \`\${result.stdout || ""}\${result.stderr || ""}\`;

  if (result.status !== 0) {
    throw new Error(
      \`Vercel Production environment audit failed inside deploy-production.mjs. No deployment upload was started. Diagnostic: \${diagnosticSnippet(output)}\`,
    );
  }

  if (output.trim()) {
    console.log(output.trim());
  }
  console.log(
    "Production environment audit passed inside deploy-production.mjs. The audit started no deployment.",
  );
}

if (redactionSelfTest) {`;

if (!source.includes(functionBefore)) {
  throw new Error(
    "Expected deploy-production git-preflight boundary was not found.",
  );
}

const callBefore = `if (!preflightOnly) {
  assertNoRecentQuotaBlock();
}

vercelCliPreflight();
gitPreflight();`;
const callAfter = `productionEnvironmentPreflight();

if (!preflightOnly) {
  assertNoRecentQuotaBlock();
}

vercelCliPreflight();
gitPreflight();`;

if (!source.includes(callBefore)) {
  throw new Error(
    "Expected deploy-production preflight call boundary was not found.",
  );
}

const next = source
  .replace(functionBefore, functionAfter)
  .replace(callBefore, callAfter);

if (next === source) {
  throw new Error("Internal deployment environment gate patch made no change.");
}

fs.writeFileSync(deployPath, next, "utf8");
console.log(
  "Applied the Vercel Production environment audit inside deploy-production.mjs before every real preflight/deploy path.",
);
