import fs from "node:fs";

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected launch-readiness source fragment was not found in ${path}.`);
  }
  const next = source.replace(before, after);
  if (next === source) {
    throw new Error(`Launch-readiness patch made no change in ${path}.`);
  }
  fs.writeFileSync(path, next, "utf8");
}

const pagePath = "src/app/admin/launch-readiness/page.tsx";
const routePath = "src/app/api/admin/launch-readiness/route.ts";

replaceExact(
  pagePath,
  `    {
      label: "Supabase Service Role",
      status: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "ready"
        : "warning",
      detail: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "SUPABASE_SERVICE_ROLE_KEY is configured for admin-only writes and webhook operations."
        : "Admin-only writes and webhook operations currently fall back to the public anon key.",
      action:
        "Set SUPABASE_SERVICE_ROLE_KEY before launch so admin settings, launch checks, and payment webhooks do not depend on public-key table permissions.",
    },`,
  `    {
      label: "Supabase Service Role",
      status: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "ready"
        : "blocked",
      detail: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "SUPABASE_SERVICE_ROLE_KEY is configured for admin-only writes, launch checks, and webhook operations."
        : "SUPABASE_SERVICE_ROLE_KEY is missing. Privileged Supabase clients fail closed, so admin writes, database launch checks, and payment webhooks cannot rely on the public anon key.",
      action:
        "Set SUPABASE_SERVICE_ROLE_KEY in the Vercel Production environment and the local operator environment, then rerun Launch Readiness before any live-payment or deployment approval.",
    },`,
);

replaceExact(
  routePath,
  `const SHIPPING_PROVIDER_OPERATOR_CHECKLIST_HREF =
  "/api/admin/shipping/provider-setup?format=operator-checklist";

function statusFromCheck(status: "passed" | "warning" | "blocked") {`,
  `const SHIPPING_PROVIDER_OPERATOR_CHECKLIST_HREF =
  "/api/admin/shipping/provider-setup?format=operator-checklist";

function missingPrivilegedSupabaseEnvironment() {
  return [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name) => !process.env[name]?.trim());
}

function buildPrivilegedSupabaseBlocker(
  origin: string | null,
  missingEnvironmentVariables: string[],
) {
  const href = "/admin/launch-readiness";
  const detail =
    "Launch Readiness cannot verify privileged database state because the required Supabase bootstrap environment is incomplete. Admin Supabase clients fail closed and do not substitute the public anon key for the service-role key.";
  const action = \`Set the missing Vercel Production and local operator environment variable name\${
    missingEnvironmentVariables.length === 1 ? "" : "s"
  }: \${missingEnvironmentVariables.join(", ")}. Then rerun Launch Readiness before any live-payment or deployment approval.\`;
  const attentionItem = {
    label: "Supabase Privileged Bootstrap",
    status: "blocked" as const,
    detail,
    action,
    href,
    url: absoluteUrl(origin, href),
  };

  return {
    generatedAt: new Date().toISOString(),
    storeId: getActiveStoreId(),
    status: {
      overall: "blocked" as const,
      nextStep: action,
      href,
      url: absoluteUrl(origin, href),
    },
    summary: {
      ready: 0,
      review: 0,
      blocked: 1,
    },
    missingEnvironmentVariables,
    attentionItems: [attentionItem],
    deploymentStarted: false,
    environmentValuesReadOrPrinted: false,
    readOnlyGuarantee:
      "No environment values were read or printed, and no deployment, Checkout, payment, postage, launch approval, or database mutation was started.",
  };
}

function privilegedSupabaseBlockerMarkdown(
  blocker: ReturnType<typeof buildPrivilegedSupabaseBlocker>,
  title: string,
) {
  const item = blocker.attentionItems[0];
  return [
    \`# \${title}\`,
    "",
    \`Generated: \${blocker.generatedAt}\`,
    \`Store: \${blocker.storeId}\`,
    "",
    "## Current Launch Posture",
    "",
    "- Overall: blocked",
    \`- Operator next step: \${blocker.status.nextStep}\`,
    \`- Operator link: \${blocker.status.url || blocker.status.href}\`,
    "- Ready: 0",
    "- Review: 0",
    "- Blocked: 1",
    "",
    "## Attention Items",
    "",
    \`- **BLOCKED - \${item.label}:** \${item.detail} Next: \${item.action}\`,
    "",
    "## Safety",
    "",
    \`- Deployment started: \${blocker.deploymentStarted ? "yes" : "no"}\`,
    \`- Environment values read or printed: \${
      blocker.environmentValuesReadOrPrinted ? "yes" : "no"
    }\`,
    \`- \${blocker.readOnlyGuarantee}\`,
    "",
  ].join("\\n");
}

function statusFromCheck(status: "passed" | "warning" | "blocked") {`,
);

replaceExact(
  routePath,
  `export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const brief = await buildBrief(requestUrl.origin);
    const format = requestUrl.searchParams.get("format");

    if (format === "markdown" || format === "md") {`,
  `export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const format = requestUrl.searchParams.get("format");
    const missingEnvironmentVariables = missingPrivilegedSupabaseEnvironment();

    if (missingEnvironmentVariables.length > 0) {
      const blocker = buildPrivilegedSupabaseBlocker(
        requestUrl.origin,
        missingEnvironmentVariables,
      );

      if (format === "markdown" || format === "md") {
        return new Response(
          privilegedSupabaseBlockerMarkdown(
            blocker,
            "TCOS Launch Readiness Brief",
          ),
          {
            status: 503,
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition":
                'attachment; filename="tcos-launch-readiness-brief.md"',
              "Content-Type": "text/markdown; charset=utf-8",
            },
          },
        );
      }

      if (format === "handoff-bundle") {
        return new Response(
          privilegedSupabaseBlockerMarkdown(
            blocker,
            "TCOS Launch Hand-off Bundle",
          ),
          {
            status: 503,
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition":
                'attachment; filename="tcos-launch-handoff-bundle.md"',
              "Content-Type": "text/markdown; charset=utf-8",
            },
          },
        );
      }

      return NextResponse.json(
        {
          success: false,
          brief: blocker,
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const brief = await buildBrief(requestUrl.origin);

    if (format === "markdown" || format === "md") {`,
);

console.log(
  "Applied Launch Readiness service-role hardening to the dashboard and JSON/Markdown handoff route.",
);
