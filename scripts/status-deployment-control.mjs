import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const strict = args.has("--strict");
const repoRoot = process.cwd();
const githubRepo =
  process.env.TCOS_GITHUB_REPO || "TruelyCollectables/truely-collectables";
const skipGithubStatus =
  args.has("--offline") || process.env.TCOS_SKIP_GITHUB_STATUS === "1";
const githubTimeoutMs = Number(process.env.TCOS_GITHUB_STATUS_TIMEOUT_MS || 5000);
const scheduledReleaseWorkflowPath =
  ".github/workflows/tcos-scheduled-production-release.yml";
const vercelJsonPath = "vercel.json";

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function statusRank(status) {
  return status === "fail" ? 3 : status === "attention" ? 2 : status === "warn" ? 1 : 0;
}

function overallStatus(checks) {
  const maxRank = Math.max(...checks.map((check) => statusRank(check.status)));
  return maxRank >= 3
    ? "fail"
    : maxRank >= 2
      ? "attention"
      : maxRank >= 1
        ? "warn"
        : "pass";
}

function checkVercelBranchDeployments() {
  const config = readJson(vercelJsonPath);
  const deploymentEnabled = config.git?.deploymentEnabled;
  const checks = [];

  if (!deploymentEnabled || typeof deploymentEnabled !== "object") {
    return {
      status: "fail",
      summary:
        "vercel.json does not explicitly suppress non-main git deployments.",
      evidence: { deploymentEnabled },
      next: "Set git.deploymentEnabled to { \"*\": false, \"main\": true } before pushing release branches.",
    };
  }

  checks.push({
    name: "wildcard disabled",
    ok: deploymentEnabled["*"] === false,
  });
  checks.push({
    name: "main enabled",
    ok: deploymentEnabled.main === true,
  });

  const extraTrueBranches = Object.entries(deploymentEnabled)
    .filter(([branch, enabled]) => branch !== "main" && enabled === true)
    .map(([branch]) => branch);

  checks.push({
    name: "no extra true branches",
    ok: extraTrueBranches.length === 0,
    extraTrueBranches,
  });

  const pass = checks.every((check) => check.ok);

  return {
    status: pass ? "pass" : "fail",
    summary: pass
      ? "Only main is allowed to trigger Vercel git deployments; all other branches are suppressed."
      : "One or more non-main branches can still trigger Vercel git deployments.",
    evidence: { deploymentEnabled, checks },
    next: pass
      ? "Keep admin-dashboard-work parked until one approved merge to main."
      : "Restore exact branch deployment control before pushing or opening broad release branches.",
  };
}

function checkVercelCrons() {
  const config = readJson(vercelJsonPath);
  const crons = Array.isArray(config.crons) ? config.crons : [];
  const inventoryPaths = [
    "/api/cron/ebay-store-fixed-price-sync",
    "/api/cron/seller-ebay-reconciliation",
  ];
  const inventoryCrons = crons.filter((cron) =>
    inventoryPaths.some((inventoryPath) =>
      String(cron.path || "").startsWith(inventoryPath),
    ),
  );

  return {
    status: "pass",
    summary:
      "Vercel crons call production functions; they do not create git deployments or spend build CPU minutes by themselves.",
    evidence: {
      totalCronJobs: crons.length,
      inventoryFreshnessCrons: inventoryCrons.map((cron) => ({
        path: cron.path,
        schedule: cron.schedule,
      })),
    },
    next:
      "Tune cron frequency separately if runtime/function usage becomes the concern; do not treat these as branch build triggers.",
  };
}

function checkScheduledReleaseWorkflowFile() {
  const source = readText(scheduledReleaseWorkflowPath);
  const hasScheduleTrigger = /^\s*schedule:\s*$/m.test(source);
  const hasManualTrigger = /^\s*workflow_dispatch:\s*$/m.test(source);
  const pushesMain = /\bgit\s+push\s+origin\s+HEAD:main\b/.test(source);
  const workBranchMatch = /^\s*WORK_BRANCH:\s*(.+)\s*$/m.exec(source);
  const schedules = [...source.matchAll(/cron:\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  const summaryLooksFalsePositive =
    source.includes("steps.changes.outputs.has_changes") &&
    source.includes(
      "A tested Market Intel batch was pushed to main. The main-only Vercel integration will create one production deployment.",
    );

  if (hasScheduleTrigger && pushesMain) {
    return {
      status: "attention",
      summary:
        "Scheduled Production Release can push to main automatically when its work-branch merge succeeds.",
      evidence: {
        path: scheduledReleaseWorkflowPath,
        hasScheduleTrigger,
        hasManualTrigger,
        pushesMain,
        workBranch: workBranchMatch?.[1]?.trim() || null,
        schedules,
        summaryLooksFalsePositive,
      },
      next:
        "Disable this workflow or convert it to workflow_dispatch-only before an intentional one-build admin dashboard release.",
    };
  }

  return {
    status: "pass",
    summary:
      "Scheduled Production Release cannot automatically push main from the checked workflow file.",
    evidence: {
      path: scheduledReleaseWorkflowPath,
      hasScheduleTrigger,
      hasManualTrigger,
      pushesMain,
      workBranch: workBranchMatch?.[1]?.trim() || null,
      schedules,
      summaryLooksFalsePositive,
    },
    next: "Use workflow_dispatch or a manual merge only when a production release is approved.",
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), githubTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function checkGithubWorkflowState() {
  if (skipGithubStatus) {
    return {
      status: "warn",
      summary: "GitHub workflow state was not checked because offline mode is active.",
      evidence: { skipped: true },
      next: "Rerun without --offline before approving a production release.",
    };
  }

  try {
    const workflows = await fetchJson(
      `https://api.github.com/repos/${githubRepo}/actions/workflows`,
    );
    const workflow = workflows.workflows?.find(
      (entry) =>
        entry.path === scheduledReleaseWorkflowPath ||
        entry.name === "TCOS Scheduled Production Release",
    );

    if (!workflow) {
      return {
        status: "warn",
        summary:
          "GitHub did not report the Scheduled Production Release workflow by path/name.",
        evidence: {
          repo: githubRepo,
          workflowCount: workflows.total_count ?? workflows.workflows?.length ?? null,
        },
        next:
          "Confirm the Actions tab manually before approving a production release.",
      };
    }

    const runs = await fetchJson(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${workflow.id}/runs?per_page=5`,
    );
    const recentRuns = (runs.workflow_runs || []).map((run) => ({
      runNumber: run.run_number,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      headSha: run.head_sha?.slice(0, 12) || null,
      url: run.html_url,
    }));
    const activeScheduledRelease = workflow.state === "active";

    return {
      status: activeScheduledRelease ? "attention" : "pass",
      summary: activeScheduledRelease
        ? "GitHub reports Scheduled Production Release as active."
        : `GitHub reports Scheduled Production Release as ${workflow.state}.`,
      evidence: {
        repo: githubRepo,
        id: workflow.id,
        state: workflow.state,
        url: workflow.html_url,
        recentRuns,
      },
      next: activeScheduledRelease
        ? "Disable the workflow in GitHub Actions before merging admin-dashboard-work to main."
        : "Keep it disabled until the approved production release is finished.",
    };
  } catch (error) {
    return {
      status: "warn",
      summary: "Could not read GitHub workflow state.",
      evidence: {
        repo: githubRepo,
        error: error instanceof Error ? error.message : String(error),
      },
      next:
        "Use the GitHub Actions tab to confirm Scheduled Production Release is disabled before approving a production release.",
    };
  }
}

function buildReleasePath(checks) {
  const scheduledReleaseNeedsAttention = checks.some(
    (check) =>
      (check.id === "github-scheduled-release-state" ||
        check.id === "scheduled-release-workflow-file") &&
      check.result.status === "attention",
  );

  return [
    scheduledReleaseNeedsAttention
      ? "Disable TCOS Scheduled Production Release in GitHub Actions, or confirm it is manual-only."
      : "Confirm TCOS Scheduled Production Release remains disabled/manual-only.",
    "Keep admin-dashboard-work parked until an explicit deploy approval is given.",
    "Immediately before release, rerun npm run status:deployment-control and npm run verify:admin-dashboard.",
    "Merge admin-dashboard-work into main once; do not push additional main commits during the same window.",
    "Let the main-only Vercel integration create the single production deployment.",
    "Run production smoke after the Vercel deployment is live.",
    "Re-enable or retune scheduled releases only after build spend is reviewed.",
  ];
}

function printTextReport(payload) {
  console.log("TCOS deployment build-control status:");
  console.log(`- overall: ${payload.overall}`);
  console.log(`- generated at: ${payload.generatedAt}`);
  console.log("");

  for (const check of payload.checks) {
    console.log(`${check.result.status.toUpperCase()} ${check.label}`);
    console.log(`- ${check.result.summary}`);
    console.log(`- next: ${check.result.next}`);
    if (check.id === "vercel-crons") {
      const inventoryCrons = check.result.evidence.inventoryFreshnessCrons || [];
      if (inventoryCrons.length > 0) {
        console.log("- inventory freshness schedules:");
        for (const cron of inventoryCrons) {
          console.log(`  - ${cron.schedule} ${cron.path}`);
        }
      }
    }
    if (check.id === "github-scheduled-release-state") {
      const recentRuns = check.result.evidence.recentRuns || [];
      if (recentRuns.length > 0) {
        console.log("- recent scheduled-release runs:");
        for (const run of recentRuns) {
          console.log(
            `  - #${run.runNumber} ${run.event} ${run.status}/${run.conclusion || "none"} ${run.createdAt} ${run.url}`,
          );
        }
      }
    }
    console.log("");
  }

  console.log("Single intentional production release path:");
  payload.singleReleasePath.forEach((step, index) => {
    console.log(`${index + 1}. ${step}`);
  });
}

const checks = [
  {
    id: "vercel-branch-deployments",
    label: "Vercel branch deployment control",
    result: checkVercelBranchDeployments(),
  },
  {
    id: "vercel-crons",
    label: "Vercel cron classification",
    result: checkVercelCrons(),
  },
  {
    id: "scheduled-release-workflow-file",
    label: "Scheduled release workflow file",
    result: checkScheduledReleaseWorkflowFile(),
  },
  {
    id: "github-scheduled-release-state",
    label: "GitHub Scheduled Production Release state",
    result: await checkGithubWorkflowState(),
  },
];

const payload = {
  schema: "tcos.deploymentControlStatus.v1",
  generatedAt: new Date().toISOString(),
  overall: overallStatus(checks.map((check) => check.result)),
  strict,
  checks,
  singleReleasePath: buildReleasePath(checks),
  noDeployGuarantee:
    "This command is read-only. It does not push git refs, merge branches, start a Vercel deployment, change aliases, call production cron endpoints, or mutate GitHub workflow state.",
};

if (jsonOutput) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  printTextReport(payload);
}

if (strict && ["attention", "fail"].includes(payload.overall)) {
  process.exit(1);
}
