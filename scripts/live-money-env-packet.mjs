const mode = process.argv.includes("--env-template")
  ? "env-template"
  : process.argv.includes("--vercel-commands")
    ? "vercel-commands"
    : "checklist";
const jsonOutput = process.argv.includes("--json");
const scopeSelfTest = process.argv.includes("--self-test-scope");
const vercelCliVersion = "56.2.0";
const vercelCliPrefix = `npm exec --yes --package=vercel@${vercelCliVersion} -- vercel --cwd "$PWD"`;

const supabaseBootstrap = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    placeholder: "https://<project-ref>.supabase.co",
    note: "Public Supabase project URL.",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    placeholder: "<supabase-anon-key>",
    note: "Browser-safe anon key. The server should still prefer the service-role key for admin writes.",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    placeholder: "<server-only-supabase-service-role-key>",
    note: "Server-only key. Never expose it through NEXT_PUBLIC_ names, browser code, screenshots, or public logs.",
  },
];

const finalLivePaymentRuntime = [
  {
    key: "STRIPE_LIVE_SECRET_KEY",
    placeholder: "sk_live_<redacted>",
    note: "Live Stripe secret key. Prefer this live-suffixed name over unsuffixed compatibility fallbacks.",
  },
  {
    key: "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY",
    placeholder: "pk_live_<redacted>",
    note: "Live Stripe publishable key.",
  },
  {
    key: "STRIPE_LIVE_WEBHOOK_SECRET",
    placeholder: "whsec_<redacted>",
    note: "Live Stripe webhook signing secret for the deployed endpoint.",
  },
  {
    key: "NEXT_PUBLIC_SITE_URL",
    placeholder: "https://truely-collectables.vercel.app",
    note: "HTTPS production origin used by Stripe redirects and webhook smoke checks.",
  },
  {
    key: "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED",
    placeholder: "false",
    note: "Keep false until live refund/dispute webhook delivery is verified.",
  },
  {
    key: "TCOS_LIVE_PAYMENTS_ENABLED",
    placeholder: "false",
    note: "Keep false until the final go-live window after accepted preflight evidence.",
  },
];

const allEntries = [...supabaseBootstrap, ...finalLivePaymentRuntime];

function normalizeVercelScope(value) {
  const trimmed = String(value).trim();

  if (!trimmed) {
    throw new Error("VERCEL_SCOPE cannot be empty.");
  }

  if (
    trimmed.startsWith("-") ||
    /[\s\/\\:?#@.]/.test(trimmed) ||
    /(?:token|password|secret|key)=/i.test(trimmed) ||
    /\b(?:sk|rk)_(?:live|test)_/i.test(trimmed) ||
    /\b(?:Bearer|Basic)\s+/i.test(trimmed)
  ) {
    throw new Error(
      "VERCEL_SCOPE must be a Vercel team slug using only lowercase letters, numbers, and hyphens.",
    );
  }

  if (
    trimmed.length > 100 ||
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(trimmed)
  ) {
    throw new Error(
      "VERCEL_SCOPE must be a Vercel team slug using only lowercase letters, numbers, and hyphens.",
    );
  }

  return trimmed;
}

function runScopeSelfTest() {
  const validCases = [
    ["truelycollectables-projects", "truelycollectables-projects"],
    ["launch-team-2026", "launch-team-2026"],
    [" team-1 ", "team-1"],
    ["a", "a"],
  ];

  for (const [input, expected] of validCases) {
    const actual = normalizeVercelScope(input);
    if (actual !== expected) {
      throw new Error(
        `Live-money env packet scope self-test normalized ${input} to ${actual}; expected ${expected}.`,
      );
    }
  }

  const invalidCases = [
    "",
    " ",
    "--prod",
    "-team",
    "team-",
    "Team",
    "team_name",
    "team.name",
    "team/name",
    "https://team.example.com",
    "team@example",
    "team?slug=other",
    "team secret",
    "token=scope-self-test-secret",
    "Bearer scope-self-test-secret",
    "a".repeat(101),
  ];

  for (const input of invalidCases) {
    try {
      normalizeVercelScope(input);
      throw new Error(
        `Live-money env packet scope self-test accepted invalid input: ${input}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("accepted invalid input") ||
        message.includes("scope-self-test-secret") ||
        !message.includes("VERCEL_SCOPE")
      ) {
        throw error;
      }
    }
  }

  console.log("Live-money env packet Vercel scope self-test passed.");
}

function printChecklist() {
  console.log("TCOS live-money environment packet");
  console.log("Purpose: stage the live-money runtime without printing or storing secret values.");
  console.log("");
  console.log("Supabase bootstrap environment:");
  for (const entry of supabaseBootstrap) {
    console.log(`- ${entry.key}: ${entry.note}`);
  }
  console.log("");
  console.log("Final live-payment runtime environment:");
  for (const entry of finalLivePaymentRuntime) {
    console.log(`- ${entry.key}: ${entry.note}`);
  }
  console.log("");
  console.log("Safe helper commands:");
  console.log("- npm run live-money:env-template");
  console.log("- npm --silent run live-money:env-packet:json");
  console.log("- npm run live-money:vercel-commands");
  console.log("- npm run status:live-money");
  console.log("- npm run archive:live-money");
  console.log("");
  console.log("Vercel CLI boundary:");
  console.log(`- Vercel command output is pinned to vercel@${vercelCliVersion} through npm exec and includes --cwd "$PWD".`);
  console.log("");
  console.log("Vercel scope boundary:");
  console.log("- VERCEL_SCOPE must be a simple lowercase Vercel team slug before Vercel command output is printed.");
  console.log("");
  console.log("Go-live boundary:");
  console.log("- Do not set TCOS_LIVE_PAYMENTS_ENABLED=true until the final go-live window.");
  console.log("- Require npm run preflight:live-money to show READY_FOR_RUNTIME_SWITCH or LIVE_MONEY_OPEN first.");
  console.log("- These helpers do not read secrets, call Stripe, call Supabase, deploy, buy postage, or create Checkout.");
}

function buildPacket() {
  return {
    schema: "tcos.liveMoneyEnvPacket.v1",
    generatedAt: new Date().toISOString(),
    title: "TCOS live-money environment packet",
    purpose: "Stage the live-money runtime without printing or storing secret values.",
    entries: {
      supabaseBootstrap,
      finalLivePaymentRuntime,
    },
    commands: {
      checklist: "npm run live-money:env-packet",
      json: "npm --silent run live-money:env-packet:json",
      envTemplate: "npm run live-money:env-template",
      vercelCommands: "npm run live-money:vercel-commands",
      status: "npm run status:live-money",
      archive: "npm run archive:live-money",
      preflight: "npm run preflight:live-money",
    },
    vercelCli: {
      version: vercelCliVersion,
      commandPrefix: vercelCliPrefix,
      boundary:
        'Vercel command output is pinned through npm exec and includes --cwd "$PWD".',
    },
    vercelScopeBoundary:
      "VERCEL_SCOPE must be a simple lowercase Vercel team slug before Vercel command output is printed.",
    goLiveBoundary: {
      runtimeSwitch:
        "Do not set TCOS_LIVE_PAYMENTS_ENABLED=true until the final go-live window.",
      acceptedPreflightStates: ["READY_FOR_RUNTIME_SWITCH", "LIVE_MONEY_OPEN"],
      preflightRequirement:
        "Require npm run preflight:live-money to show READY_FOR_RUNTIME_SWITCH or LIVE_MONEY_OPEN first.",
    },
    readOnlyGuarantee:
      "This helper prints only environment names, placeholders, command shapes, and operator notes; it does not read secrets, call Stripe, call Supabase, deploy, buy postage, create Checkout, approve launch, revoke launch, or change runtime switches.",
  };
}

function printPacketJson() {
  console.log(JSON.stringify(buildPacket(), null, 2));
}

function printEnvTemplate() {
  const lines = [
    "# TCOS live-money environment template",
    "# Copy values from Supabase, Stripe, and the production deployment settings.",
    "# This template intentionally contains placeholders only. Do not commit filled values.",
    "",
    "# Supabase bootstrap environment",
    ...supabaseBootstrap.flatMap((entry) => [
      `# ${entry.note}`,
      `${entry.key}=${entry.placeholder}`,
    ]),
    "",
    "# Final live-payment runtime environment",
    ...finalLivePaymentRuntime.flatMap((entry) => [
      `# ${entry.note}`,
      `${entry.key}=${entry.placeholder}`,
    ]),
    "",
    "# Final-window reminder",
    "# Keep TCOS_LIVE_PAYMENTS_ENABLED=false until preflight evidence is accepted.",
    "",
  ];

  console.log(lines.join("\n"));
}

function printVercelCommands() {
  const scope = normalizeVercelScope(
    process.env.VERCEL_SCOPE ?? "truelycollectables-projects",
  );
  const lines = [
    "# TCOS live-money Vercel env command checklist",
    "# These commands prompt for values. They do not contain secret values.",
    `# Commands pin Vercel CLI ${vercelCliVersion} through npm exec and pass --cwd "$PWD".`,
    "# Keep TCOS_LIVE_PAYMENTS_ENABLED=false until final accepted preflight evidence.",
    "# VERCEL_SCOPE must be a simple lowercase Vercel team slug before command output is printed.",
    `# Scope: ${scope}`,
    "",
    "# Production environment",
    ...allEntries.map(
      (entry) =>
        `${vercelCliPrefix} env add ${entry.key} production --scope ${scope}`,
    ),
    "",
    "# Preview environment, if you want the same staged shape before production",
    ...allEntries.map(
      (entry) =>
        `${vercelCliPrefix} env add ${entry.key} preview --scope ${scope}`,
    ),
    "",
    "# After env changes, redeploy only when the deployment quota is available.",
    "# Then run npm run smoke:production, npm run archive:live-money, and final-window npm run archive:live-money:preflight.",
    "",
  ];

  console.log(lines.join("\n"));
}

if (scopeSelfTest) {
  runScopeSelfTest();
} else if (jsonOutput) {
  printPacketJson();
} else if (mode === "env-template") {
  printEnvTemplate();
} else if (mode === "vercel-commands") {
  printVercelCommands();
} else {
  printChecklist();
}
