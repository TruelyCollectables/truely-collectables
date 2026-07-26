import fs from "node:fs";

const packagePath = "package.json";
const source = fs.readFileSync(packagePath, "utf8");
const before = `    "live-money:vercel-commands": "node scripts/live-money-env-packet.mjs --vercel-commands",
    "preflight:production": "node scripts/deploy-production.mjs --preflight-only",
    "verify:production": "npm run preflight:deployment-control && npm run lint && npm run verify:admin-dashboard && npm run status:live-money && npm run verify:instacomp && npm run verify:shipping && npm run build && npm run check:production-guardrails && npm run preflight:production",
    "deploy:production": "node scripts/deploy-production.mjs",
    "smoke:production": "node scripts/smoke-production.mjs",`;
const after = `    "live-money:vercel-commands": "node scripts/live-money-env-packet.mjs --vercel-commands",
    "audit:vercel-production-env": "node scripts/audit-vercel-production-environment.mjs",
    "audit:vercel-production-env:json": "node scripts/audit-vercel-production-environment.mjs --json",
    "audit:vercel-production-env:self-test": "node scripts/audit-vercel-production-environment.mjs --self-test",
    "preflight:production": "npm run audit:vercel-production-env && node scripts/deploy-production.mjs --preflight-only",
    "verify:production": "npm run preflight:deployment-control && npm run lint && npm run verify:admin-dashboard && npm run status:live-money && npm run verify:instacomp && npm run verify:shipping && npm run build && npm run check:production-guardrails && npm run preflight:production",
    "deploy:production": "npm run audit:vercel-production-env && node scripts/deploy-production.mjs",
    "smoke:production": "node scripts/smoke-production.mjs",`;

if (!source.includes(before)) {
  throw new Error(
    "Expected production deployment command block was not found in package.json.",
  );
}

const next = source.replace(before, after);
if (next === source) {
  throw new Error("Production deployment environment gate patch made no change.");
}

JSON.parse(next);
fs.writeFileSync(packagePath, next, "utf8");
console.log(
  "Applied the read-only Vercel Production environment audit before production preflight and deployment commands.",
);
