import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = process.cwd();
const MODE = process.argv[2] || "inventory";
const ARGUMENTS = Object.fromEntries(
  process.argv.slice(3).map((value) => {
    const [key, ...rest] = value.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);
const AUDIT_ROOT = path.join(ROOT, ".audit");
const OUT = path.join(AUDIT_ROOT, MODE);
fs.mkdirSync(OUT, { recursive: true });

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx",
  ".sql", ".css", ".scss", ".html", ".xml", ".yml", ".yaml", ".toml",
  ".sh", ".txt", ".csv", ".tsv", ".graphql", ".gql", ".prisma", ".env.example",
]);
const CRITICAL_PUBLIC_PATHS = [
  "/", "/shop", "/cart", "/account/signup", "/account/login", "/privacy",
  "/shipping", "/returns", "/terms", "/contact", "/buyer-protection",
  "/robots.txt", "/sitemap.xml",
];
const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "account.updated",
];

function command(commandName, args = [], options = {}) {
  return execFileSync(commandName, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function gitFiles() {
  return command("git", ["ls-files", "-z"]).split("\0").filter(Boolean);
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function isTextFile(file) {
  const normalized = normalizePath(file);
  const extension = path.extname(normalized).toLowerCase();
  return (
    TEXT_EXTENSIONS.has(extension) ||
    normalized.endsWith(".env.example") ||
    ["Dockerfile", "Procfile", "LICENSE"].includes(path.basename(normalized))
  );
}

function safeRead(file) {
  try {
    const stat = fs.statSync(path.join(ROOT, file));
    if (!stat.isFile() || stat.size > 3_000_000) return null;
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redact(value) {
  return String(value ?? "")
    .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "[REDACTED_STRIPE_KEY]")
    .replace(/whsec_[A-Za-z0-9_-]+/g, "[REDACTED_WEBHOOK_SECRET]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .slice(0, 20_000);
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(name, value) {
  fs.writeFileSync(path.join(OUT, name), value.endsWith("\n") ? value : `${value}\n`);
}

function pushFinding(findings, severity, area, message, evidence = null) {
  findings.push({ severity, area, message, evidence });
}

function lineMatches(text, regex, file) {
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    regex.lastIndex = 0;
    if (regex.test(lines[index])) {
      matches.push({ file, line: index + 1 });
    }
  }
  return matches;
}

function routeUrlFromFile(file) {
  let route = normalizePath(file)
    .replace(/^src\/app/, "")
    .replace(/\/route\.(?:ts|js)$/, "")
    .replace(/\/page\.(?:tsx|jsx|ts|js)$/, "");
  route = route
    .split("/")
    .filter((part) => part && !/^\(.+\)$/.test(part))
    .join("/");
  return `/${route}`.replace(/\/+/g, "/");
}

function extractRepositoryFacts(files) {
  const tableNames = new Set();
  const rpcNames = new Set();
  const envNames = new Set();
  const routeFiles = [];
  const pageFiles = [];
  const migrations = [];
  const workflows = [];
  const scripts = [];
  let totalLines = 0;
  const fileManifest = [];

  for (const file of files) {
    const full = path.join(ROOT, file);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      continue;
    }
    const text = isTextFile(file) ? safeRead(file) : null;
    const lines = text === null ? null : text.split(/\r?\n/).length;
    if (lines) totalLines += lines;
    fileManifest.push({ file, size, lines, sha256: text === null ? null : sha256(text) });
    if (/^src\/app\/api\/.+\/route\.(?:ts|js)$/.test(file)) routeFiles.push(file);
    if (/^src\/app\/.+\/page\.(?:tsx|jsx|ts|js)$/.test(file) || file === "src/app/page.tsx") pageFiles.push(file);
    if (/^supabase\/migrations\/.+\.sql$/.test(file)) migrations.push(file);
    if (/^\.github\/workflows\/.+\.ya?ml$/.test(file)) workflows.push(file);
    if (/^scripts\//.test(file)) scripts.push(file);
    if (!text) continue;
    for (const match of text.matchAll(/\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) tableNames.add(match[1]);
    for (const match of text.matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]\s*[),]/g)) rpcNames.add(match[1]);
    for (const match of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envNames.add(match[1]);
  }

  return {
    trackedFiles: files.length,
    totalTextLines: totalLines,
    apiRouteCount: routeFiles.length,
    pageCount: pageFiles.length,
    migrationCount: migrations.length,
    workflowCount: workflows.length,
    scriptFileCount: scripts.length,
    tableNames: [...tableNames].sort(),
    rpcNames: [...rpcNames].sort(),
    envNames: [...envNames].sort(),
    routeFiles: routeFiles.sort(),
    pages: pageFiles.map((file) => ({ file, url: routeUrlFromFile(file) })).sort((a, b) => a.url.localeCompare(b.url)),
    migrations: migrations.sort(),
    workflows: workflows.sort(),
    scripts: scripts.sort(),
    fileManifest,
  };
}

async function inventoryAudit() {
  const files = gitFiles();
  const facts = extractRepositoryFacts(files);
  const findings = [];
  const highConfidenceSecrets = [];
  const patternInventory = {};
  const secretPatterns = [
    ["stripe_secret", /sk_(?:live|test)_[A-Za-z0-9_-]{16,}/g],
    ["stripe_webhook_secret", /whsec_[A-Za-z0-9_-]{16,}/g],
    ["github_token", /gh[pousr]_[A-Za-z0-9_]{20,}/g],
    ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["aws_key", /AKIA[0-9A-Z]{16}/g],
    ["jwt", /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g],
  ];
  const sourcePatterns = [
    ["todo", /\bTODO\b/i],
    ["fixme", /\bFIXME\b/i],
    ["hack", /\bHACK\b/i],
    ["dangerous_html", /dangerouslySetInnerHTML/],
    ["eval", /\beval\s*\(/],
    ["new_function", /new\s+Function\s*\(/],
    ["child_process", /node:child_process|from\s+["']child_process["']/],
    ["raw_http", /http:\/\/(?!127\.0\.0\.1|localhost)/],
    ["any_type", /:\s*any\b|as\s+any\b/],
    ["eslint_disable", /eslint-disable/],
  ];

  for (const file of files.filter(isTextFile)) {
    const text = safeRead(file);
    if (!text) continue;
    const lower = `${file}\n${text}`.toLowerCase();
    const obviousFixture = /fixture|example|placeholder|mock|test|simulation/.test(lower);
    for (const [name, regex] of secretPatterns) {
      regex.lastIndex = 0;
      const values = [...text.matchAll(regex)];
      if (!values.length) continue;
      for (const value of values) {
        if (/placeholder|example|build.only|test.fixture/i.test(value[0]) || obviousFixture) continue;
        highConfidenceSecrets.push({ file, type: name, fingerprint: sha256(value[0]).slice(0, 16) });
      }
    }
    for (const [name, regex] of sourcePatterns) {
      const matches = lineMatches(text, regex, file);
      if (matches.length) patternInventory[name] = [...(patternInventory[name] || []), ...matches];
    }
  }

  if (highConfidenceSecrets.length) {
    pushFinding(findings, "blocker", "source-security", `${highConfidenceSecrets.length} high-confidence secret candidates were found in tracked source.`, highConfidenceSecrets);
  } else {
    pushFinding(findings, "verified", "source-security", "No high-confidence production secret pattern was found in the tracked source snapshot.");
  }
  pushFinding(findings, "verified", "repository", `Inventoried ${facts.trackedFiles} tracked files and ${facts.totalTextLines.toLocaleString("en-US")} text lines.`);
  pushFinding(findings, "verified", "repository", `Inventoried ${facts.apiRouteCount} API routes, ${facts.pageCount} pages, ${facts.migrationCount} migrations, ${facts.workflowCount} workflows, and ${facts.scriptFileCount} script files.`);

  const bundleRoot = path.join(OUT, "source-text");
  fs.rmSync(bundleRoot, { recursive: true, force: true });
  for (const file of files.filter(isTextFile)) {
    const text = safeRead(file);
    if (text === null) continue;
    const destination = path.join(bundleRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  try {
    command("tar", ["-czf", path.join(OUT, "source-text.tar.gz"), "-C", bundleRoot, "."]);
  } finally {
    fs.rmSync(bundleRoot, { recursive: true, force: true });
  }

  const result = { mode: MODE, sourceSha: command("git", ["rev-parse", "HEAD"]).trim(), facts, highConfidenceSecrets, patternInventory, findings };
  writeJson("repository-inventory.json", result);
  writeText("repository-inventory.md", [
    "# Truely Collectables repository inventory",
    "",
    `- Source SHA: \`${result.sourceSha}\``,
    `- Tracked files: ${facts.trackedFiles}`,
    `- Text lines: ${facts.totalTextLines.toLocaleString("en-US")}`,
    `- API routes: ${facts.apiRouteCount}`,
    `- Pages: ${facts.pageCount}`,
    `- Database migrations: ${facts.migrationCount}`,
    `- Workflows: ${facts.workflowCount}`,
    `- Script files: ${facts.scriptFileCount}`,
    `- High-confidence secret candidates: ${highConfidenceSecrets.length}`,
    "",
    "## Pattern counts",
    ...Object.entries(patternInventory).sort().map(([name, values]) => `- ${name}: ${values.length}`),
  ].join("\n"));
  if (highConfidenceSecrets.length) process.exitCode = 1;
}

function routeProtectionSignals(text) {
  const signals = [];
  const checks = [
    ["admin-session", /isValidAdminSessionValue|requireAdmin|ADMIN_SESSION_COOKIE/],
    ["account-auth", /getAuthenticatedAccountFromRequest|requireAuthenticated|requireAccount/],
    ["seller-auth", /requireSeller|seller membership|role:\s*["']seller["']/i],
    ["cron-secret", /CRON_SECRET|x-cron|cron secret/i],
    ["bearer-token", /authorization|Bearer|bearerToken/i],
    ["stripe-signature", /stripe-signature|webhooks\.constructEvent/],
    ["rate-limit", /checkPublicEndpointRateLimit/],
    ["signed-token", /verify.*token|validate.*token|signed.*token/i],
    ["oauth-state", /verify.*state|signed.*state/i],
  ];
  for (const [name, regex] of checks) if (regex.test(text)) signals.push(name);
  return signals;
}

async function routeAudit() {
  const files = gitFiles().filter((file) => /^src\/app\/api\/.+\/route\.(?:ts|js)$/.test(file));
  const findings = [];
  const routes = [];
  const knownPublicPrefixes = [
    "/api/account/login", "/api/account/signup", "/api/account/password", "/api/checkout",
    "/api/offers", "/api/webhook", "/api/products", "/api/product", "/api/storefront",
    "/api/health", "/api/tcos-profit-hunter/actions/openapi", "/api/ebay/oauth/callback",
  ];
  for (const file of files) {
    const text = safeRead(file) || "";
    const url = routeUrlFromFile(file);
    const methods = [...text.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1]);
    const mutation = methods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method));
    const privilegedSignals = [
      /createSupabaseServerClient\(\{\s*admin:\s*true\s*\}\)/,
      /\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /\.delete\s*\(/,
      /InventoryEngine|InventoryRepository/, /new\s+Stripe\s*\(/,
    ].filter((regex) => regex.test(text)).length;
    const protectionSignals = routeProtectionSignals(text);
    const publicKnown = knownPublicPrefixes.some((prefix) => url.startsWith(prefix));
    const protectedByProxy = url.startsWith("/api/admin/");
    const suspicious = mutation && privilegedSignals > 0 && protectionSignals.length === 0 && !protectedByProxy && !publicKnown;
    routes.push({ file, url, methods, mutation, privilegedSignals, protectionSignals, publicKnown, protectedByProxy, suspicious });
    if (suspicious) pushFinding(findings, "blocker", "api-security", `Privileged mutation route has no recognized authentication or signature signal: ${url}`, { file, methods });
  }
  const proxy = safeRead("src/proxy.ts") || safeRead("src/middleware.ts") || "";
  const proxyChecks = ["/admin", "/api/admin", "/seller", "/api/cron"];
  for (const prefix of proxyChecks) {
    if (proxy.includes(prefix)) pushFinding(findings, "verified", "route-proxy", `Proxy source contains protection handling for ${prefix}.`);
    else pushFinding(findings, prefix === "/seller" ? "warning" : "blocker", "route-proxy", `Proxy source does not visibly mention ${prefix}.`);
  }
  const suspiciousRoutes = routes.filter((route) => route.suspicious);
  if (!suspiciousRoutes.length) pushFinding(findings, "verified", "api-security", `No unprotected privileged mutation was identified across ${routes.length} API route files by the independent route classifier.`);
  writeJson("api-route-audit.json", { sourceSha: command("git", ["rev-parse", "HEAD"]).trim(), routes, findings });
  writeText("api-route-audit.md", [
    "# API route audit",
    "",
    `- Routes inspected: ${routes.length}`,
    `- Suspicious privileged mutations: ${suspiciousRoutes.length}`,
    "",
    ...findings.map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.area}: ${finding.message}`),
  ].join("\n"));
  if (findings.some((finding) => finding.severity === "blocker")) process.exitCode = 1;
}

function tail(value, length = 12_000) {
  const text = redact(value);
  return text.length > length ? text.slice(-length) : text;
}

async function simulationAudit() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const scripts = packageJson.scripts || {};
  const shard = Number(ARGUMENTS.shard || 0);
  const shards = Number(ARGUMENTS.shards || 1);
  const excluded = /instacomp-trial|final-tester|monitor|live-benchmark|protected-preview|production-deploy|backup|install/i;
  const selected = Object.keys(scripts)
    .filter((name) => name.startsWith("simulate:"))
    .filter((name) => !excluded.test(name))
    .sort()
    .filter((_, index) => index % shards === shard);
  const results = [];
  for (const name of selected) {
    const started = Date.now();
    const result = spawnSync("npm", ["run", name], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    });
    results.push({
      name,
      command: scripts[name],
      durationMs: Date.now() - started,
      status: result.error?.code === "ETIMEDOUT" ? "timeout" : result.status === 0 ? "passed" : "failed",
      exitCode: result.status,
      signal: result.signal,
      stdoutTail: tail(result.stdout || ""),
      stderrTail: tail(result.stderr || result.error?.message || ""),
    });
  }
  const failed = results.filter((result) => result.status !== "passed");
  const report = { shard, shards, selectedCount: selected.length, passed: results.length - failed.length, failed: failed.length, results };
  writeJson(`simulation-shard-${shard}.json`, report);
  writeText(`simulation-shard-${shard}.md`, [
    `# Simulation shard ${shard + 1}/${shards}`,
    "",
    `- Selected: ${selected.length}`,
    `- Passed: ${report.passed}`,
    `- Failed or timed out: ${report.failed}`,
    "",
    ...results.map((result) => `- ${result.status === "passed" ? "PASS" : "FAIL"}: ${result.name} (${Math.round(result.durationMs / 1000)}s)`),
  ].join("\n"));
  if (failed.length) process.exitCode = 1;
}

function sameOriginHref(base, href) {
  try {
    const value = new URL(href, base);
    const origin = new URL(base).origin;
    if (value.origin !== origin) return null;
    if (!["http:", "https:"].includes(value.protocol)) return null;
    value.hash = "";
    return value.toString();
  } catch {
    return null;
  }
}

function extractHrefs(html, base) {
  const values = new Set();
  for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    const absolute = sameOriginHref(base, match[1]);
    if (absolute) values.add(absolute);
  }
  return [...values];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = Date.now();
    const response = await fetch(url, { redirect: "manual", ...options, signal: controller.signal });
    const body = await response.text();
    return { url, status: response.status, headers: Object.fromEntries(response.headers.entries()), body, durationMs: Date.now() - started };
  } catch (error) {
    return { url, status: 0, headers: {}, body: "", durationMs: 0, error: redact(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function liveAudit() {
  const base = String(process.env.AUDIT_BASE_URL || "https://truelycollectables.com").replace(/\/$/, "");
  const findings = [];
  const critical = [];
  for (const pathname of CRITICAL_PUBLIC_PATHS) {
    const response = await fetchWithTimeout(`${base}${pathname}`);
    critical.push({ pathname, status: response.status, durationMs: response.durationMs, headers: response.headers, bodyBytes: Buffer.byteLength(response.body), error: response.error || null });
    if (response.status === 200) pushFinding(findings, "verified", "live-critical-route", `${pathname} returned HTTP 200.`);
    else pushFinding(findings, "blocker", "live-critical-route", `${pathname} returned HTTP ${response.status || "network failure"}.`, response.error || null);
  }

  const home = await fetchWithTimeout(`${base}/`);
  const headerRequirements = [
    ["strict-transport-security", "warning"],
    ["x-content-type-options", "blocker"],
    ["referrer-policy", "warning"],
    ["content-security-policy", "warning"],
    ["permissions-policy", "warning"],
  ];
  for (const [header, missingSeverity] of headerRequirements) {
    if (home.headers[header]) pushFinding(findings, "verified", "security-header", `${header} is present.`);
    else pushFinding(findings, missingSeverity, "security-header", `${header} is missing from the homepage response.`);
  }
  if (home.headers["x-frame-options"] || /frame-ancestors/i.test(home.headers["content-security-policy"] || "")) {
    pushFinding(findings, "verified", "security-header", "Clickjacking protection is present through X-Frame-Options or CSP frame-ancestors.");
  } else {
    pushFinding(findings, "warning", "security-header", "No clickjacking header was observed.");
  }

  const startUrls = [`${base}/`, `${base}/shop`];
  const queue = [...startUrls];
  const visited = new Set();
  const crawl = [];
  while (queue.length && visited.size < 300) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const parsed = new URL(url);
    if (/\/(?:admin|seller|api)\b/.test(parsed.pathname)) continue;
    const response = await fetchWithTimeout(url, { headers: { "User-Agent": "TruelyLaunchAudit/20260729" } });
    crawl.push({ url, status: response.status, durationMs: response.durationMs, bytes: Buffer.byteLength(response.body), contentType: response.headers["content-type"] || "", error: response.error || null });
    if (response.status === 200 && /text\/html/i.test(response.headers["content-type"] || "")) {
      for (const href of extractHrefs(response.body, base)) {
        const next = new URL(href);
        if (!visited.has(href) && !/\/(?:admin|seller|api)\b/.test(next.pathname) && !/\.(?:jpg|jpeg|png|gif|webp|svg|ico|pdf|zip)$/i.test(next.pathname)) queue.push(href);
      }
    }
  }
  const brokenCrawl = crawl.filter((row) => row.status === 0 || row.status >= 400);
  if (brokenCrawl.length) pushFinding(findings, "blocker", "live-link-crawl", `${brokenCrawl.length} crawled internal URLs failed.`, brokenCrawl.slice(0, 50));
  else pushFinding(findings, "verified", "live-link-crawl", `${crawl.length} internal public URLs were crawled without an HTTP 4xx/5xx response.`);

  const shop = await fetchWithTimeout(`${base}/shop`);
  const productUrls = extractHrefs(shop.body, base).filter((url) => /\/product\//.test(new URL(url).pathname)).slice(0, 25);
  const productChecks = [];
  for (const url of productUrls) {
    const response = await fetchWithTimeout(url);
    productChecks.push({ url, status: response.status, bytes: Buffer.byteLength(response.body), hasPrice: /\$\d/.test(response.body), hasCartOrOffer: /Add To Cart|Make It Mine|Shoot Me an Offer|View Item/i.test(response.body) });
  }
  const badProducts = productChecks.filter((row) => row.status !== 200 || !row.hasPrice || !row.hasCartOrOffer);
  if (!productUrls.length) pushFinding(findings, "blocker", "product-pages", "No product URLs were discoverable from the live shop HTML.");
  else if (badProducts.length) pushFinding(findings, "blocker", "product-pages", `${badProducts.length} of ${productChecks.length} sampled product pages failed content checks.`, badProducts);
  else pushFinding(findings, "verified", "product-pages", `${productChecks.length} sampled product pages returned HTTP 200 with price and purchase/offer controls.`);

  const protectedChecks = [];
  const protectedPaths = [
    ["/admin", [301, 302, 303, 307, 308, 401, 403]],
    ["/admin/orders", [301, 302, 303, 307, 308, 401, 403]],
    ["/seller", [301, 302, 303, 307, 308, 401, 403]],
    ["/api/admin/orders", [401, 403, 404, 405]],
    ["/api/cron/ebay-store-fixed-price-sync", [401, 403, 405]],
    ["/api/account/seller/payout-onboarding", [401, 403, 405]],
    ["/api/tcos-profit-hunter/actions/status", [401, 403]],
  ];
  for (const [pathname, accepted] of protectedPaths) {
    const response = await fetchWithTimeout(`${base}${pathname}`);
    protectedChecks.push({ pathname, status: response.status, location: response.headers.location || null });
    if (accepted.includes(response.status)) pushFinding(findings, "verified", "unauthenticated-access", `${pathname} rejected or redirected unauthenticated access with HTTP ${response.status}.`);
    else pushFinding(findings, "blocker", "unauthenticated-access", `${pathname} returned unexpected HTTP ${response.status} without authentication.`);
  }

  const apiChecks = [];
  const signup = await fetchWithTimeout(`${base}/api/account/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "", password: "", tosAccepted: false }),
  });
  apiChecks.push({ name: "buyer-signup-invalid", status: signup.status, cardVerification: signup.headers["x-tcos-account-auth-card-verification"] || null, hasStripeRedirect: /cardVerificationUrl|stripeSessionId/.test(signup.body), body: redact(signup.body) });
  if ([400, 422].includes(signup.status) && signup.headers["x-tcos-account-auth-card-verification"] === "not_required" && !/https:\/\/checkout\.stripe\.com/i.test(signup.body)) {
    pushFinding(findings, "verified", "buyer-signup", "Invalid non-mutating buyer signup confirms card verification is not required and returns no Stripe redirect.");
  } else {
    pushFinding(findings, "blocker", "buyer-signup", "Live buyer signup policy did not pass the no-card-verification probe.", apiChecks.at(-1));
  }

  const login = await fetchWithTimeout(`${base}/api/account/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "invalid-audit@example.invalid", password: "not-a-real-password" }),
  });
  apiChecks.push({ name: "buyer-login-invalid", status: login.status, cardVerification: login.headers["x-tcos-account-auth-card-verification"] || null, body: redact(login.body) });
  if ([400, 401, 403, 429].includes(login.status) && !/access_token|refresh_token/i.test(login.body)) pushFinding(findings, "verified", "buyer-login", `Invalid credentials were rejected with HTTP ${login.status} and no session token.`);
  else pushFinding(findings, "blocker", "buyer-login", `Invalid login returned unexpected HTTP ${login.status} or exposed a token.`);

  const webhook = await fetchWithTimeout(`${base}/api/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  apiChecks.push({ name: "webhook-no-signature", status: webhook.status, body: redact(webhook.body) });
  if ([400, 401].includes(webhook.status)) pushFinding(findings, "verified", "stripe-webhook", "Webhook rejected an unsigned request.");
  else pushFinding(findings, "blocker", "stripe-webhook", `Webhook returned HTTP ${webhook.status} without a Stripe signature.`);

  const checkout = await fetchWithTimeout(`${base}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  apiChecks.push({ name: "checkout-empty", status: checkout.status, body: redact(checkout.body) });
  if (checkout.status >= 400 && checkout.status < 500) pushFinding(findings, "verified", "checkout-validation", `Empty checkout was rejected with HTTP ${checkout.status} before a session could be created.`);
  else pushFinding(findings, checkout.status === 503 ? "blocker" : "warning", "checkout-validation", `Empty checkout returned HTTP ${checkout.status}; live payment readiness may be unavailable or validation order needs review.`, redact(checkout.body));

  writeJson("live-production-audit.json", { base, checkedAt: new Date().toISOString(), critical, crawl, productChecks, protectedChecks, apiChecks, findings });
  writeText("live-production-audit.md", [
    "# Live Production audit",
    "",
    `- Base URL: ${base}`,
    `- Critical routes: ${critical.length}`,
    `- Crawled internal URLs: ${crawl.length}`,
    `- Product pages sampled: ${productChecks.length}`,
    `- Findings: ${findings.length}`,
    "",
    ...findings.map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.area}: ${finding.message}`),
  ].join("\n"));
  if (findings.some((finding) => finding.severity === "blocker")) process.exitCode = 1;
}

function recursiveFindSecretValue(value, keyMatcher, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = recursiveFindSecretValue(item, keyMatcher, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (keyMatcher.test(key) && typeof child === "string" && child.length > 20) return child;
    const found = recursiveFindSecretValue(child, keyMatcher, depth + 1);
    if (found) return found;
  }
  return null;
}

async function runtimeAudit() {
  const findings = [];
  const sourceFacts = extractRepositoryFacts(gitFiles());
  const { createClient } = await import("@supabase/supabase-js");
  const Stripe = (await import("stripe")).default;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    pushFinding(findings, "blocker", "supabase", "Production Supabase URL or service-role key was unavailable to the read-only audit runner.");
    writeJson("runtime-integrations-audit.json", { checkedAt: new Date().toISOString(), findings });
    process.exitCode = 1;
    return;
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const tableCoverage = [];
  for (const table of sourceFacts.tableNames) {
    try {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      tableCoverage.push({ table, ok: !error, count: count ?? null, error: error ? redact(error.message) : null });
    } catch (error) {
      tableCoverage.push({ table, ok: false, count: null, error: redact(error?.message || error) });
    }
  }
  const accessibleTables = tableCoverage.filter((row) => row.ok);
  pushFinding(findings, "verified", "supabase-schema", `${accessibleTables.length} source-referenced public tables responded to service-role count queries.`);
  const unexpectedFailures = tableCoverage.filter((row) => !row.ok && !/bucket|storage|not find|schema cache|relation/i.test(row.error || ""));
  if (unexpectedFailures.length) pushFinding(findings, "warning", "supabase-schema", `${unexpectedFailures.length} source-referenced table probes failed unexpectedly.`, unexpectedFailures.slice(0, 50));

  async function fetchAll(table, pageSize = 1000, maxRows = 50_000) {
    const rows = [];
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);
      if (error) return { rows: [], error: redact(error.message) };
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { rows, error: null };
  }

  const keyTables = [
    "products", "inventory_items", "inventory_images", "orders", "order_items", "offers",
    "account_profiles", "account_store_memberships", "seller_profiles", "seller_payout_accounts",
    "store_settings", "ebay_tokens", "connected_accounts", "store_accounts", "order_notification_outbox",
    "checkout_attempts", "checkout_inventory_reservations", "stripe_webhook_events",
  ];
  const data = {};
  for (const table of keyTables) {
    const coverage = tableCoverage.find((row) => row.table === table);
    if (coverage && !coverage.ok) continue;
    const result = await fetchAll(table);
    if (!result.error) data[table] = result.rows;
  }

  const products = data.products || [];
  const inventory = data.inventory_items || [];
  const images = data.inventory_images || [];
  const orders = data.orders || [];
  const orderItems = data.order_items || [];
  const profiles = data.account_profiles || [];
  const memberships = data.account_store_memberships || [];
  const activeProducts = products.filter((row) => Number(row.quantity) > 0 && Number(row.price) > 0 && !row.archived_at && !["sold", "archived", "inactive"].includes(String(row.status || "").toLowerCase()));
  const duplicateEbay = new Map();
  for (const row of products) {
    if (!row.ebay_item_id) continue;
    const key = String(row.ebay_item_id);
    duplicateEbay.set(key, [...(duplicateEbay.get(key) || []), row.id]);
  }
  const duplicateEbayRows = [...duplicateEbay.entries()].filter(([, ids]) => ids.length > 1);
  if (duplicateEbayRows.length) pushFinding(findings, "blocker", "inventory", `${duplicateEbayRows.length} duplicate eBay item IDs exist in products.`, duplicateEbayRows.slice(0, 25));
  else pushFinding(findings, "verified", "inventory", `No duplicate non-null eBay item ID was found across ${products.length} products.`);
  const invalidProductAmounts = products.filter((row) => Number(row.price) < 0 || Number(row.quantity) < 0);
  if (invalidProductAmounts.length) pushFinding(findings, "blocker", "inventory", `${invalidProductAmounts.length} products have negative price or quantity.`);
  else pushFinding(findings, "verified", "inventory", "No product has a negative price or quantity.");
  const activeMissingImage = activeProducts.filter((row) => !row.image_url);
  if (activeMissingImage.length) pushFinding(findings, "blocker", "inventory", `${activeMissingImage.length} active sellable products have no primary image.`, activeMissingImage.slice(0, 25).map((row) => row.id));
  else pushFinding(findings, "verified", "inventory", `${activeProducts.length} active sellable products have primary images.`);

  const inventoryKeyMap = new Map();
  for (const row of inventory) {
    const key = `${row.store_id || ""}:${row.legacy_product_id || ""}`;
    inventoryKeyMap.set(key, [...(inventoryKeyMap.get(key) || []), row.id]);
  }
  const duplicateInventory = [...inventoryKeyMap.entries()].filter(([key, ids]) => !key.endsWith(":") && ids.length > 1);
  if (duplicateInventory.length) pushFinding(findings, "blocker", "inventory", `${duplicateInventory.length} duplicate store/product inventory identities exist.`, duplicateInventory.slice(0, 25));
  else pushFinding(findings, "verified", "inventory", `No duplicate store/product inventory identity was found across ${inventory.length} inventory rows.`);
  const productById = new Map(products.map((row) => [String(row.id), row]));
  const orphanInventory = inventory.filter((row) => row.legacy_product_id && !productById.has(String(row.legacy_product_id)));
  if (orphanInventory.length) pushFinding(findings, "blocker", "inventory", `${orphanInventory.length} inventory rows reference missing products.`);
  else pushFinding(findings, "verified", "inventory", "No inventory row references a missing legacy product.");
  const imageByInventory = new Map();
  for (const row of images) imageByInventory.set(String(row.inventory_item_id || row.inventory_id || ""), [...(imageByInventory.get(String(row.inventory_item_id || row.inventory_id || "")) || []), row]);
  const multiplePrimary = [...imageByInventory.entries()].filter(([, rows]) => rows.filter((row) => row.is_primary === true).length > 1);
  if (multiplePrimary.length) pushFinding(findings, "blocker", "inventory-images", `${multiplePrimary.length} inventory rows have multiple primary images.`);
  else pushFinding(findings, "verified", "inventory-images", `No inventory row has more than one primary image across ${images.length} image rows.`);

  const orderById = new Map(orders.map((row) => [String(row.id), row]));
  const orphanOrderItems = orderItems.filter((row) => row.order_id && !orderById.has(String(row.order_id)));
  if (orphanOrderItems.length) pushFinding(findings, "blocker", "orders", `${orphanOrderItems.length} order items reference missing orders.`);
  else pushFinding(findings, "verified", "orders", `No orphan order item was found across ${orderItems.length} order items and ${orders.length} orders.`);
  const invalidOrderItems = orderItems.filter((row) => Number(row.quantity ?? 1) <= 0 || Number(row.price ?? row.unit_price ?? 0) < 0);
  if (invalidOrderItems.length) pushFinding(findings, "blocker", "orders", `${invalidOrderItems.length} order items have invalid quantity or price.`);

  const duplicateEmails = new Map();
  for (const row of profiles) {
    if (!row.email) continue;
    const email = String(row.email).trim().toLowerCase();
    duplicateEmails.set(email, [...(duplicateEmails.get(email) || []), row.id]);
  }
  const duplicateProfileEmails = [...duplicateEmails.entries()].filter(([, ids]) => ids.length > 1);
  if (duplicateProfileEmails.length) pushFinding(findings, "blocker", "buyer-accounts", `${duplicateProfileEmails.length} duplicate buyer profile emails exist.`);
  else pushFinding(findings, "verified", "buyer-accounts", `No duplicate normalized email was found across ${profiles.length} account profiles.`);
  const pendingBuyers = profiles.filter((row) => String(row.account_status || "").toLowerCase() === "payment_verification_required" && String(row.default_account_type || "buyer").toLowerCase() === "buyer");
  if (pendingBuyers.length) pushFinding(findings, "warning", "buyer-accounts", `${pendingBuyers.length} legacy buyer profiles remain pending card verification and will be migrated on next authenticated use.`, pendingBuyers.map((row) => row.id).slice(0, 25));
  else pushFinding(findings, "verified", "buyer-accounts", "No buyer profile remains blocked by the retired card-verification status.");
  const membershipKeys = new Map();
  for (const row of memberships) {
    const key = `${row.account_id}:${row.store_id}:${row.role}`;
    membershipKeys.set(key, (membershipKeys.get(key) || 0) + 1);
  }
  const duplicateMemberships = [...membershipKeys.entries()].filter(([, count]) => count > 1);
  if (duplicateMemberships.length) pushFinding(findings, "blocker", "accounts", `${duplicateMemberships.length} duplicate account/store/role memberships exist.`);
  else pushFinding(findings, "verified", "accounts", `No duplicate account/store/role membership was found across ${memberships.length} rows.`);

  const liveStripeKey = process.env.STRIPE_LIVE_SECRET_KEY || (String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_") ? process.env.STRIPE_SECRET_KEY : null);
  const stripeSummary = { configured: Boolean(liveStripeKey), account: null, webhookEndpoints: [] };
  if (!liveStripeKey) {
    pushFinding(findings, "blocker", "stripe", "A dedicated live Stripe secret key was not available to the Production audit.");
  } else {
    try {
      const stripe = new Stripe(liveStripeKey);
      const account = await stripe.accounts.retrieve();
      stripeSummary.account = { idPresent: Boolean(account.id), chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted, country: account.country, defaultCurrency: account.default_currency };
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
      stripeSummary.webhookEndpoints = endpoints.data.map((endpoint) => ({ id: endpoint.id, url: endpoint.url, status: endpoint.status, enabledEvents: endpoint.enabled_events }));
      const target = endpoints.data.filter((endpoint) => endpoint.url === "https://truelycollectables.com/api/webhook" && endpoint.status === "enabled");
      if (target.length !== 1) pushFinding(findings, "blocker", "stripe", `Expected exactly one enabled custom-domain Stripe webhook; found ${target.length}.`);
      else {
        const missingEvents = REQUIRED_STRIPE_EVENTS.filter((event) => !target[0].enabled_events.includes(event) && !target[0].enabled_events.includes("*"));
        if (missingEvents.length) pushFinding(findings, "blocker", "stripe", `The live Stripe webhook is missing ${missingEvents.length} required events.`, missingEvents);
        else pushFinding(findings, "verified", "stripe", "Exactly one enabled custom-domain Stripe webhook contains every required checkout, refund, dispute, and account event.");
      }
      if (account.charges_enabled) pushFinding(findings, "verified", "stripe", "Stripe reports charges enabled on the platform account.");
      else pushFinding(findings, "blocker", "stripe", "Stripe reports charges disabled on the platform account.");
    } catch (error) {
      pushFinding(findings, "blocker", "stripe", "Stripe read-only account or webhook verification failed.", redact(error?.message || error));
    }
  }

  const resendSummary = { configured: Boolean(process.env.RESEND_API_KEY), domains: [] };
  if (!process.env.RESEND_API_KEY) {
    pushFinding(findings, "blocker", "resend", "RESEND_API_KEY was unavailable in Production environment evidence.");
  } else {
    try {
      const response = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
      const json = await response.json();
      resendSummary.domains = (json.data || []).map((domain) => ({ name: domain.name, status: domain.status, region: domain.region }));
      const verified = resendSummary.domains.some((domain) => /truelycollectables\.com$/i.test(domain.name) && domain.status === "verified");
      if (response.ok && verified) pushFinding(findings, "verified", "resend", "Resend reports the Truely Collectables sending domain as verified.");
      else pushFinding(findings, "blocker", "resend", "Resend did not return a verified Truely Collectables sending domain.", { status: response.status, domains: resendSummary.domains });
    } catch (error) {
      pushFinding(findings, "blocker", "resend", "Resend domain verification failed.", redact(error?.message || error));
    }
  }

  const ebaySummary = { environment: process.env.EBAY_ENVIRONMENT || null, appToken: false, browseSearch: false, sellerRefreshTokenPresent: false, sellerTradingRead: null, latestReceipt: null };
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    pushFinding(findings, "blocker", "ebay", "eBay Production client credentials were unavailable.");
  } else {
    try {
      const tokenResponse = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
      });
      const tokenJson = await tokenResponse.json();
      ebaySummary.appToken = tokenResponse.ok && Boolean(tokenJson.access_token);
      if (!ebaySummary.appToken) throw new Error(`eBay application token HTTP ${tokenResponse.status}`);
      const browse = await fetch("https://api.ebay.com/buy/browse/v1/item_summary/search?q=sports%20card&limit=1", { headers: { authorization: `Bearer ${tokenJson.access_token}`, "x-ebay-c-marketplace-id": "EBAY_US" } });
      ebaySummary.browseSearch = browse.ok;
      if (browse.ok) pushFinding(findings, "verified", "ebay", "eBay Production application-token minting and Browse search succeeded.");
      else pushFinding(findings, "blocker", "ebay", `eBay Browse search failed with HTTP ${browse.status}.`);
    } catch (error) {
      pushFinding(findings, "blocker", "ebay", "eBay Production application-token verification failed.", redact(error?.message || error));
    }

    const possibleTokenRows = [...(data.ebay_tokens || []), ...(data.connected_accounts || []), ...(data.store_accounts || [])];
    const refreshToken = recursiveFindSecretValue(possibleTokenRows, /refresh.*token|token.*refresh/i);
    ebaySummary.sellerRefreshTokenPresent = Boolean(refreshToken);
    if (!refreshToken) {
      pushFinding(findings, "warning", "ebay", "No seller refresh token was discoverable in the known account tables for a direct read-only Trading API proof.");
    } else {
      try {
        const refreshResponse = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
          method: "POST",
          headers: { authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: "https://api.ebay.com/oauth/api_scope" }),
        });
        const refreshJson = await refreshResponse.json();
        if (!refreshResponse.ok || !refreshJson.access_token) throw new Error(`seller token refresh HTTP ${refreshResponse.status}`);
        const xml = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${refreshJson.access_token}</eBayAuthToken></RequesterCredentials><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList><DetailLevel>ReturnAll</DetailLevel></GetMyeBaySellingRequest>`;
        const trading = await fetch("https://api.ebay.com/ws/api.dll", { method: "POST", headers: { "x-ebay-api-call-name": "GetMyeBaySelling", "x-ebay-api-compatibility-level": "1231", "x-ebay-api-siteid": "0", "content-type": "text/xml" }, body: xml });
        const tradingText = await trading.text();
        const total = Number(tradingText.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)?.[1] || 0);
        const ack = tradingText.match(/<Ack>([^<]+)<\/Ack>/)?.[1] || null;
        ebaySummary.sellerTradingRead = { httpStatus: trading.status, ack, activeEntries: total };
        if (trading.ok && ["Success", "Warning"].includes(ack)) pushFinding(findings, "verified", "ebay", `Seller-authorized Trading API active-list read succeeded and reports ${total} active entries.`);
        else pushFinding(findings, "blocker", "ebay", `Seller-authorized Trading API read failed with HTTP ${trading.status} / Ack ${ack}.`);
      } catch (error) {
        pushFinding(findings, "blocker", "ebay", "Seller-authorized Trading API proof failed.", redact(error?.message || error));
      }
    }
  }

  for (const row of [...(data.connected_accounts || []), ...(data.store_accounts || [])]) {
    const receipt = recursiveFindSecretValue(row, /full.*receipt|sync.*receipt|last.*receipt/i);
    if (receipt) {
      try { ebaySummary.latestReceipt = JSON.parse(receipt); } catch { ebaySummary.latestReceipt = { present: true, parseable: false }; }
      break;
    }
  }

  const outboxRows = data.order_notification_outbox || [];
  if (outboxRows.length) {
    const failed = outboxRows.filter((row) => ["failed", "dead", "exhausted"].includes(String(row.status || "").toLowerCase()));
    const pending = outboxRows.filter((row) => ["pending", "retry", "processing"].includes(String(row.status || "").toLowerCase()));
    if (failed.length) pushFinding(findings, "blocker", "notifications", `${failed.length} order notification outbox rows are failed/dead/exhausted.`);
    else pushFinding(findings, "verified", "notifications", `No failed/dead/exhausted row exists in the ${outboxRows.length}-row order notification outbox.`);
    if (pending.length) pushFinding(findings, "warning", "notifications", `${pending.length} order notification rows are pending or processing.`);
  }

  const result = {
    checkedAt: new Date().toISOString(),
    sourceSha: command("git", ["rev-parse", "HEAD"]).trim(),
    tableCoverage,
    keyTableCounts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    stripeSummary,
    resendSummary,
    ebaySummary,
    findings,
  };
  writeJson("runtime-integrations-audit.json", result);
  writeText("runtime-integrations-audit.md", [
    "# Production runtime and integrations audit",
    "",
    `- Source SHA: ${result.sourceSha}`,
    `- Source-referenced tables probed: ${tableCoverage.length}`,
    `- Key tables loaded: ${Object.keys(data).length}`,
    "",
    ...findings.map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.area}: ${finding.message}`),
  ].join("\n"));
  if (findings.some((finding) => finding.severity === "blocker")) process.exitCode = 1;
}

switch (MODE) {
  case "inventory":
    await inventoryAudit();
    break;
  case "routes":
    await routeAudit();
    break;
  case "simulations":
    await simulationAudit();
    break;
  case "live":
    await liveAudit();
    break;
  case "runtime":
    await runtimeAudit();
    break;
  default:
    throw new Error(`Unknown audit mode: ${MODE}`);
}
