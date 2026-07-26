import fs from "node:fs";

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected admin-session hardening fragment was not found in ${path}.`);
  }
  const next = source.replace(before, after);
  if (next === source) {
    throw new Error(`Admin-session hardening made no change in ${path}.`);
  }
  fs.writeFileSync(path, next, "utf8");
}

replaceExact(
  "src/lib/admin-session.ts",
  `function getSessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}`,
  `function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret?.trim() || "";
}`,
);

replaceExact(
  "src/lib/admin-session.ts",
  `  if (!secret) {
    throw new Error("ADMIN_PASSWORD or ADMIN_SESSION_SECRET is required");
  }`,
  `  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is required");
  }`,
);

replaceExact(
  "src/app/admin/launch-readiness/page.tsx",
  `    {
      label: "Admin Access",
      status: isConfigured(process.env.ADMIN_PASSWORD)
        ? isConfigured(process.env.ADMIN_SESSION_SECRET)
          ? "ready"
          : "warning"
        : "blocked",
      detail: isConfigured(process.env.ADMIN_SESSION_SECRET)
        ? "Admin password and signed session secret are configured."
        : "Admin sessions fall back to ADMIN_PASSWORD when ADMIN_SESSION_SECRET is missing.",
      action: "Set ADMIN_PASSWORD and a separate strong ADMIN_SESSION_SECRET before launch.",
    },`,
  `    {
      label: "Admin Access",
      status:
        isConfigured(process.env.ADMIN_PASSWORD) &&
        isConfigured(process.env.ADMIN_SESSION_SECRET)
          ? "ready"
          : "blocked",
      detail:
        isConfigured(process.env.ADMIN_PASSWORD) &&
        isConfigured(process.env.ADMIN_SESSION_SECRET)
          ? "Admin password and an independently configured signed-session secret are ready."
          : "ADMIN_PASSWORD and ADMIN_SESSION_SECRET are both required. Admin session creation and validation fail closed when the dedicated session-signing secret is missing.",
      action:
        "Set ADMIN_PASSWORD and a separate strong ADMIN_SESSION_SECRET in the Vercel Production environment and local operator environment before launch.",
    },`,
);

replaceExact(
  "src/app/api/admin/launch-readiness/route.ts",
  `    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name) => !process.env[name]?.trim());`,
  `    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ADMIN_SESSION_SECRET",
  ].filter((name) => !process.env[name]?.trim());`,
);

replaceExact(
  "src/app/api/admin/launch-readiness/route.ts",
  `  const detail =
    "Launch Readiness cannot verify privileged database state because the required Supabase bootstrap environment is incomplete. Admin Supabase clients fail closed and do not substitute the public anon key for the service-role key.";`,
  `  const detail =
    "Launch Readiness cannot verify privileged runtime state because required server-only bootstrap environment is incomplete. Admin Supabase clients and admin sessions fail closed; the public anon key cannot replace the service-role key, and ADMIN_PASSWORD cannot replace the session-signing secret.";`,
);

replaceExact(
  "src/app/api/admin/launch-readiness/route.ts",
  `    label: "Supabase Privileged Bootstrap",`,
  `    label: "Privileged Runtime Bootstrap",`,
);

console.log(
  "Applied independent admin-session secret enforcement across session signing and Launch Readiness.",
);
