import fs from "node:fs";
import path from "node:path";

const roots = [
  "src/app/kingmaker",
  "src/app/api/kingmaker",
  "src/app/api/account/seller",
  "src/lib",
];

const kingmakerUi = [];
for (const root of ["src/app/kingmaker", "src/components"]) {
  if (!fs.existsSync(root)) continue;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) kingmakerUi.push(p);
    }
  };
  walk(root);
}

const urls = new Set();
for (const f of kingmakerUi) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/["'](\/api\/[^"']+)["']/g)) {
    const u = m[1];
    if (/kingmaker|instacomp/i.test(u)) urls.add(u.split("?")[0]);
  }
}

function routePath(url) {
  const rel = url.replace(/^\/api\//, "");
  return path.join("src/app/api", rel, "route.ts");
}

const offenders = [];
for (const url of [...urls].sort()) {
  const f = routePath(url);
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, "utf8");
  if (
    /createSupabaseServerClient|@supabase\/supabase-js|storefront-publication-server|\.from\(["'](?:inventory_items|inventory_images|products|instacomp_|tcos_card_)/.test(
      s,
    )
  ) {
    offenders.push({ url, file: f });
  }
}

for (const f of [
  "src/app/api/kingmaker",
  "src/lib/kingmaker-mac-scan-server.ts",
  "src/lib/instacomp-ai-local.ts",
]) {
  if (!fs.existsSync(f)) continue;
}

if (offenders.length) {
  console.error("KINGMAKER NO-SUPABASE AUDIT FAILED");
  for (const o of offenders) console.error(`${o.url} -> ${o.file}`);
  process.exit(1);
}
console.log(`KINGMAKER NO-SUPABASE AUDIT PASS (${urls.size} active UI API paths checked)`);
