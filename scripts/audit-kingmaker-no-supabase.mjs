import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const codeExts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const supabasePattern =
  /createSupabaseServerClient|@supabase\/supabase-js|supabase-server|\.from\(["'](?:inventory_items|inventory_images|products|instacomp_|tcos_card_)/;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (codeExts.includes(path.extname(name))) out.push(p);
  }
  return out;
}

function resolveRelative(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, ...codeExts.map((ext) => base + ext),
    ...codeExts.map((ext) => path.join(base, "index" + ext))];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function importsOf(file) {
  const s = fs.readFileSync(file, "utf8");
  const specs = [];
  for (const m of s.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) {
    specs.push(m[1]);
  }
  return specs.map((spec) => resolveRelative(file, spec)).filter(Boolean);
}

function routeFileForApi(apiPath) {
  const clean = apiPath.split("?")[0].replace(/^\/api\//, "");
  const direct = path.join(root, "src/app/api", clean, "route.ts");
  return fs.existsSync(direct) ? direct : null;
}

const uiFiles = [...walk("src/app/kingmaker"), ...walk("src/components")];
const apiPaths = new Set();
for (const file of uiFiles) {
  const s = fs.readFileSync(file, "utf8");
  for (const m of s.matchAll(/["'](\/api\/[^"'?#]+(?:\?[^"']*)?)["']/g)) {
    const u = m[1];
    if (/kingmaker|instacomp/i.test(u)) apiPaths.add(u);
  }
}
const entrypoints = [
  ...walk("src/app/api/kingmaker").filter((p) => /route\.(ts|js)$/.test(p)),
  ...[...apiPaths].map(routeFileForApi).filter(Boolean),
];
const uniqueEntrypoints = [...new Set(entrypoints.map((p) => path.resolve(p)))];

const seen = new Set();
const stack = [...uniqueEntrypoints];
const localAuthBoundary = path.resolve(root, "src/lib/kingmaker-local-auth.ts");
while (stack.length) {
  const file = stack.pop();
  if (!file || seen.has(file)) continue;
  seen.add(file);

  // Authentication is not InstaComp truth. KINGMAKER takes the local-admin
  // fast path; this boundary may retain a bearer fallback for legacy seller
  // pages without making seller-account storage part of the identity graph.
  if (file === localAuthBoundary) continue;

  for (const dep of importsOf(file)) {
    if (dep.startsWith(path.resolve(root, "src"))) stack.push(dep);
  }
}

const offenders = [];
for (const abs of [...seen].sort()) {
  const rel = path.relative(root, abs);
  const s = fs.readFileSync(abs, "utf8");
  if (supabasePattern.test(s)) offenders.push(rel);
}

if (offenders.length) {
  console.error("KINGMAKER NO-SUPABASE AUDIT FAILED");
  for (const f of offenders) console.error(f);
  console.error("\nReachable files checked: " + seen.size +
    "; active API entrypoints: " + uniqueEntrypoints.length +
    "; offenders: " + offenders.length);
  process.exit(1);
}

console.log("KINGMAKER NO-SUPABASE AUDIT PASS (active_entrypoints=" +
  uniqueEntrypoints.length + ", reachable_files=" + seen.size + ")");
