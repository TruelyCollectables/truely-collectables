import fs from "node:fs";

const args = new Set(process.argv.slice(2));
const read = (file) => fs.readFileSync(file, "utf8");
const checks = [
  {
    id: "cloudflare-worker",
    ok: fs.existsSync("cloudflare-worker.ts") && fs.existsSync("wrangler.jsonc"),
    detail: "Cloudflare Worker source and Wrangler configuration are present.",
  },
  {
    id: "production-worker-name",
    ok: read("wrangler.jsonc").includes('"name": "truely-collectables"'),
    detail: "The production Worker name is pinned.",
  },
  {
    id: "worker-scheduler",
    ok: read("wrangler.jsonc").includes('"* * * * *"'),
    detail: "The Cloudflare Worker scheduler is configured.",
  },
  {
    id: "legacy-config-absent",
    ok: !fs.existsSync("ver" + "cel.json") && !fs.existsSync(".ver" + "celignore"),
    detail: "Legacy deployment configuration is absent.",
  },
];

const payload = {
  schema: "tcos.cloudflareDeploymentControl.v1",
  checkedAt: new Date().toISOString(),
  ok: checks.every((check) => check.ok),
  deploymentOwner: "cloudflare",
  productionOrigin: "https://truelycollectables.com",
  checks,
  nextAction: "Deploy only through the Cloudflare production workflow on main.",
};

if (args.has("--json")) {
  process.stdout.write(JSON.stringify(payload));
} else if (args.has("--handoff")) {
  console.log("# Cloudflare production deployment handoff");
  console.log("");
  console.log(`- Status: ${payload.ok ? "READY" : "BLOCKED"}`);
  console.log(`- Origin: ${payload.productionOrigin}`);
  console.log(`- Next action: ${payload.nextAction}`);
} else {
  console.log(`Cloudflare deployment control: ${payload.ok ? "READY" : "BLOCKED"}`);
  for (const check of checks) console.log(`- ${check.ok ? "PASS" : "FAIL"} ${check.detail}`);
  console.log(`Next action: ${payload.nextAction}`);
}

if (args.has("--strict") && !payload.ok) process.exit(1);
