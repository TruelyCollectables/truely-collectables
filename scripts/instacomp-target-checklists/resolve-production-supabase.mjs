import { appendFileSync } from "node:fs";

const accessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "");
const githubEnv = String(process.env.GITHUB_ENV || "");
if (!accessToken) throw new Error("GH_SUPABASE_ACCESS_TOKEN is required.");
if (!githubEnv) throw new Error("GITHUB_ENV is required.");

async function fetchJson(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(45_000),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : null;
      lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < 5) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 2_000));
  }
  throw lastError || new Error("Supabase management request failed.");
}

const projects = await fetchJson("https://api.supabase.com/v1/projects");
const candidates = (Array.isArray(projects) ? projects : []).filter((project) => {
  const name = String(project?.name || "").toLowerCase();
  return name.includes("truely") || name.includes("collect");
});
if (candidates.length !== 1) throw new Error(`Expected one Truely Collectables Supabase project, found ${candidates.length}.`);
const projectRef = String(candidates[0]?.id || candidates[0]?.ref || "");
if (!projectRef) throw new Error("Production Supabase project ref is missing.");
const keys = await fetchJson(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`);
const role = (Array.isArray(keys) ? keys : []).find((key) => {
  const normalized = String(key?.name || key?.id || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return normalized === "service_role";
});
const serviceKey = String(role?.api_key || "");
if (!serviceKey) throw new Error("Production service_role key was not returned.");
console.log(`::add-mask::${serviceKey}`);
appendFileSync(githubEnv, `NEXT_PUBLIC_SUPABASE_URL=https://${projectRef}.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${serviceKey}\n`);
console.log(`Resolved Production Supabase project ${projectRef}.`);
