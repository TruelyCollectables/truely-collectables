import fs from "node:fs";

// Re-triggered after the temporary workflow existed on the audit branch.
const workflowPath = ".github/workflows/active-market-integrity.yml";
let source = fs.readFileSync(workflowPath, "utf8");

function replaceCount(before, after, expectedCount) {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} occurrence(s) of CI fragment but found ${count}.`,
    );
  }
  source = source.split(before).join(after);
}

replaceCount(
  `      - "package.json"\n      - "src/lib/active-market-*.ts"`,
  `      - "package.json"\n      - "scripts/deploy-production.mjs"\n      - "src/lib/active-market-*.ts"`,
  2,
);
replaceCount(
  `      - "scripts/run-production-deploy-environment-gate-simulations.mjs"\n      - "scripts/run-ebay-import-admin-client-simulations.ts"`,
  `      - "scripts/run-production-deploy-environment-gate-simulations.mjs"\n      - "scripts/run-internal-deploy-environment-gate-simulations.mjs"\n      - "scripts/run-ebay-import-admin-client-simulations.ts"`,
  2,
);
replaceCount(
  `      - name: Validate production deploy environment gate\n        run: node scripts/run-production-deploy-environment-gate-simulations.mjs\n\n      - name: Audit launch database migration coverage`,
  `      - name: Validate production deploy environment gate\n        run: node scripts/run-production-deploy-environment-gate-simulations.mjs\n\n      - name: Validate internal deploy environment gate\n        run: node scripts/run-internal-deploy-environment-gate-simulations.mjs\n\n      - name: Audit launch database migration coverage`,
  1,
);

fs.writeFileSync(workflowPath, source, "utf8");
console.log(
  "Added deploy-production.mjs and its internal environment-gate regression to release CI.",
);
