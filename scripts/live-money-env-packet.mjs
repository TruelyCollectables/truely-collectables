const scope = process.env.VERCEL_SCOPE?.trim() || "truelycollectables-projects";
const mode = process.argv.includes("--env-template")
  ? "env-template"
  : process.argv.includes("--vercel-commands")
    ? "vercel-commands"
    : "checklist";

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
  console.log("- npm run live-money:vercel-commands");
  console.log("- npm run status:live-money");
  console.log("- npm run archive:live-money");
  console.log("");
  console.log("Go-live boundary:");
  console.log("- Do not set TCOS_LIVE_PAYMENTS_ENABLED=true until the final go-live window.");
  console.log("- Require npm run preflight:live-money to show READY_FOR_RUNTIME_SWITCH or LIVE_MONEY_OPEN first.");
  console.log("- These helpers do not read secrets, call Stripe, call Supabase, deploy, buy postage, or create Checkout.");
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
  const lines = [
    "# TCOS live-money Vercel env command checklist",
    "# These commands prompt for values. They do not contain secret values.",
    "# Keep TCOS_LIVE_PAYMENTS_ENABLED=false until final accepted preflight evidence.",
    `# Scope: ${scope}`,
    "",
    "# Production environment",
    ...allEntries.map((entry) => `vercel env add ${entry.key} production --scope ${scope}`),
    "",
    "# Preview environment, if you want the same staged shape before production",
    ...allEntries.map((entry) => `vercel env add ${entry.key} preview --scope ${scope}`),
    "",
    "# After env changes, redeploy only when the deployment quota is available.",
    "# Then run npm run smoke:production, npm run archive:live-money, and final-window npm run archive:live-money:preflight.",
    "",
  ];

  console.log(lines.join("\n"));
}

if (mode === "env-template") {
  printEnvTemplate();
} else if (mode === "vercel-commands") {
  printVercelCommands();
} else {
  printChecklist();
}
