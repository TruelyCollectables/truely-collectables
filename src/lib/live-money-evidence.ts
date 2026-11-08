export const LIVE_MONEY_JSON_EVIDENCE = {
  title: "Live Money JSON Evidence",
  schema: "tcos.liveMoneyGoNoGo.v1",
  statusCommand: "npm --silent run status:live-money:json",
  preflightCommand: "npm --silent run preflight:live-money:json",
  archiveCommand: "npm run archive:live-money",
  preflightArchiveCommand: "npm run archive:live-money:preflight",
  archiveDirectory: ".codex-run/live-money-evidence/",
  readyStates: ["READY_FOR_RUNTIME_SWITCH", "LIVE_MONEY_OPEN"],
  blockedStates: [
    "BLOCKED_UNEVALUATED",
    "BLOCKED_APPROVAL",
    "READY_FOR_DATABASE_APPROVAL",
    "BLOCKED_LAUNCH_GATE",
  ],
  archiveRequirement:
    "Archive the status JSON after production smoke passes, preferably with npm run archive:live-money, then archive the preflight JSON during the final go-live window with npm run archive:live-money:preflight before changing TCOS_LIVE_PAYMENTS_ENABLED.",
  environmentChecklist: {
    supabaseBootstrap: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ],
    finalLivePaymentRuntime: [
      "STRIPE_LIVE_SECRET_KEY or STRIPE_SECRET_KEY with an sk_live_ value",
      "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY with a pk_live_ value",
      "STRIPE_LIVE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET for the live endpoint",
      "NEXT_PUBLIC_SITE_URL or the active store primary domain as the HTTPS production origin",
      "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED=true only after live refund/dispute webhook delivery is verified",
      "TCOS_LIVE_PAYMENTS_ENABLED=true only during the final go-live window after accepted preflight evidence",
    ],
  },
  readOnlyGuarantee:
    "Both commands are read-only evidence commands and must not create Checkout Sessions, Customers, PaymentIntents, refunds, disputes, payouts, labels, postage purchases, Coverage policies, launch approvals, or revocations.",
} as const;

export function liveMoneyJsonEvidenceMarkdownLines(
  evidence = LIVE_MONEY_JSON_EVIDENCE,
) {
  return [
    "## Live Money JSON Evidence",
    "",
    `- Schema: \`${evidence.schema}\``,
    `- Post-smoke raw JSON command: \`${evidence.statusCommand}\``,
    `- Final-window raw preflight command: \`${evidence.preflightCommand}\``,
    `- Post-smoke archive helper: \`${evidence.archiveCommand}\``,
    `- Final-window preflight archive helper: \`${evidence.preflightArchiveCommand}\``,
    `- Timestamped archive directory: \`${evidence.archiveDirectory}\``,
    `- Accepted go-live states: ${evidence.readyStates.join(", ")}`,
    `- Halt states: ${evidence.blockedStates.join(", ")}`,
    `- Archive requirement: ${evidence.archiveRequirement}`,
    `- Supabase bootstrap environment: ${evidence.environmentChecklist.supabaseBootstrap.join("; ")}`,
    `- Final live-payment runtime environment: ${evidence.environmentChecklist.finalLivePaymentRuntime.join("; ")}`,
    `- Read-only guarantee: ${evidence.readOnlyGuarantee}`,
  ];
}
