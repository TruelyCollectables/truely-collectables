const jsonOutput = process.argv.includes("--json");
const status = {
  productionOrigin: "https://truelycollectables.com",
  productionProvider: "cloudflare-workers",
  workerName: "truely-collectables",
  scheduler: "cloudflare-cron-trigger",
  deploymentBranch: "main",
  legacyProviderDecommissioned: true,
  smokeCommand: "npm run smoke:production",
};

if (jsonOutput) {
  console.log(JSON.stringify(status, null, 2));
} else {
  console.log("Truely Collectables production status");
  console.log(`- Origin: ${status.productionOrigin}`);
  console.log(`- Runtime: ${status.productionProvider}`);
  console.log(`- Worker: ${status.workerName}`);
  console.log(`- Scheduler: ${status.scheduler}`);
  console.log(`- Branch: ${status.deploymentBranch}`);
  console.log(`- Smoke: ${status.smokeCommand}`);
}
