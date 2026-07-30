import fs from "node:fs";

function parseEnvFile(file: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

const envFile = process.env.PRODUCTION_ENV_FILE;
const accessToken = process.env.GH_SUPABASE_ACCESS_TOKEN;
if (!envFile || !accessToken) {
  throw new Error(
    "PRODUCTION_ENV_FILE and GH_SUPABASE_ACCESS_TOKEN are required",
  );
}

const env = parseEnvFile(envFile);
const productionUrl = env.NEXT_PUBLIC_SUPABASE_URL;
if (!productionUrl || !/^https:\/\//.test(productionUrl)) {
  throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled");
}
const projectRef = new URL(productionUrl).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const query = `
  begin;
  revoke all on table public.collx_only_inventory_boundary_violations
    from public, anon, authenticated;
  grant select on table public.collx_only_inventory_boundary_violations
    to service_role;
  commit;
`;

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query, parameters: [], read_only: false }),
});
const body = await response.text();
if (!response.ok) {
  throw new Error(
    `Supabase CollX grant repair failed with HTTP ${response.status}: ${body.slice(0, 2000)}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      projectRef,
      view: "public.collx_only_inventory_boundary_violations",
      grantedRole: "service_role",
      publicRolesRevoked: ["public", "anon", "authenticated"],
      appliedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
