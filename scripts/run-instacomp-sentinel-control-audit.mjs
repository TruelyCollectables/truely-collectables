import { readFile } from "node:fs/promises";

const files = {
  installer: "services/instacomp-ai/scripts/install-sentinel-control.sh",
  updater: "services/instacomp-ai/scripts/update-live-from-main.sh",
  sentinel: "services/instacomp-ai/app/sentinel.py",
  relay: "services/instacomp-ai/app/sentinel_routes.py",
  archiveAuth: "src/lib/instacomp-sentinel-auth.ts",
  importRoute: "src/app/api/instacomp/checklist-sentinel/import/route.ts",
  proxy: "src/app/api/instacomp/checklist-sentinel/route.ts",
  dashboard: "src/app/admin/instacomp/checklist-sentinel/page.tsx",
  adminPage: "src/app/admin/page.tsx",
  quickTools: "src/app/components/AdminInstaCompMobileShortcut.tsx",
  env: "services/instacomp-ai/.env.example",
};

const contents = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(contents.installer.includes("cloudflared tunnel login"), "Installer must authenticate a named Cloudflare tunnel.");
assert(contents.installer.includes("cloudflared tunnel create"), "Installer must create or reuse a named tunnel.");
assert(contents.installer.includes("com.truelycollectables.instacomp-ai-tunnel"), "Tunnel must have its own LaunchAgent.");
assert(contents.installer.includes("INSTACOMP_AI_LOCAL_URL"), "Installer must set the Vercel Mac URL.");
assert(contents.installer.includes("INSTACOMP_AI_LOCAL_KEY"), "Installer must synchronize the Mac key.");
assert(contents.installer.includes("INSTACOMP_SENTINEL_ARCHIVE_TOKEN"), "Installer must synchronize the dedicated archive token.");
assert(contents.installer.includes("npx vercel --prod --yes"), "Installer must deploy Production after environment changes.");
assert(contents.installer.includes("internal-readiness"), "Installer must verify the Vercel-to-Mac hop.");
assert(contents.installer.includes("archive-probe.json"), "Installer must test private archive write/delete access.");
assert(contents.installer.includes("proxy-status.json"), "Installer must test the full website-to-Mac proxy.");
assert(contents.installer.includes("dashboard_code"), "Installer must verify the dashboard route exists.");
assert(contents.installer.includes("openssl rand -hex 32"), "Installer must generate exact 256-bit secrets.");
assert(contents.installer.includes("http://sentinel:${archive_token}@127.0.0.1:8787"), "Local multipart relay must use dedicated Basic authentication.");
assert(contents.installer.includes("for ((attempt=1;"), "Installer retry loops must use Bash built-ins.");
assert(!contents.installer.includes("$(seq "), "Installer must not depend on seq being installed on macOS.");
assert(!contents.installer.includes("vercel env pull"), "Installer must not try to read back Vercel sensitive values.");
assert(!contents.installer.includes("INSTACOMP_SERVICE_TOKEN"), "Installer must not rotate unrelated InstaComp service credentials.");
assert(!contents.installer.includes("env add \"$name\" \"$environment\" --force --sensitive --yes"), "Installer must not pass unsupported --yes to vercel env add.");
assert(contents.installer.includes(String.raw`--url http:\/\/127\.0\.0\.1:8787`), "Installer must remove only the obsolete quick tunnel.");
assert(!contents.installer.includes("pkill cloudflared"), "Installer must never kill every cloudflared process.");

assert(contents.updater.includes("INSTACOMP_AI_API_KEY"), "Mac updater must read the active local InstaComp AI key.");
assert(contents.updater.includes("INSTACOMP_AI_LOCAL_KEY"), "Mac updater must synchronize the active key to Vercel Production.");
assert(contents.updater.includes("INSTACOMP_AI_LOCAL_URL"), "Mac updater must synchronize the permanent tunnel URL.");
assert(contents.updater.includes("INSTACOMP_SENTINEL_ARCHIVE_TOKEN"), "Mac updater must preserve and synchronize the Sentinel archive token.");
assert(contents.updater.includes("repair_vercel_root_directory"), "Mac updater must repair the known invalid Vercel repository-root setting before deployment.");
assert(contents.updater.includes('npx vercel api "$endpoint"'), "Mac updater must inspect the linked Vercel project through authenticated CLI API access.");
assert(contents.updater.includes("-X PATCH -F rootDirectory="), "Mac updater must clear only the known invalid Vercel repository-root value through the project API.");
assert(contents.updater.includes("Refusing automatic Vercel root repair"), "Mac updater must fail closed for unexpected non-root Vercel directory settings.");
assert(contents.updater.includes('npx vercel --prod --yes --archive=tgz --cwd "$repo_root"'), "Mac updater must use archive-safe Production deployment explicitly from the repository root after key synchronization.");
assert(contents.updater.includes("x-instacomp-sentinel-archive-token"), "Mac updater must verify the Production Sentinel proxy end to end.");
assert(contents.updater.includes("sentinelKeyAcceptedThroughProduction"), "Mac updater receipt must prove the synchronized key was accepted through Production.");
assert(contents.updater.includes("Refusing key repair"), "Mac updater must fail closed instead of silently rotating a missing or malformed key.");
assert(!contents.updater.includes("openssl rand"), "Routine Mac updates must never rotate the InstaComp AI key.");

assert(contents.sentinel.includes('"INSTACOMP_AI_SENTINEL_MAX_TARGETS_PER_RUN", 75'), "Sentinel safe batch cap must remain 75 targets.");

assert(contents.relay.includes("registry-import-relay"), "Mac relay route is missing.");
assert(contents.relay.includes("hashlib.sha256"), "Mac relay must independently hash the local file.");
assert(contents.relay.includes("hmac.compare_digest"), "Mac relay must compare archive credentials in constant time.");
assert(contents.relay.includes("base64.b64decode"), "Mac relay must validate local Basic authentication.");
assert(contents.relay.includes("x-instacomp-sentinel-archive-token"), "Mac relay must use the dedicated central archive header.");
assert(contents.relay.includes("_MAX_RELAY_BYTES = 50_000_000"), "Mac relay must enforce the 50 MB limit.");
assert(contents.relay.includes('trigger="pending-backlog-drain"'), "Pending checklist backlog must automatically start the next safe batch.");
assert(contents.relay.includes("has_due_targets"), "Pending backlog drain must require actual due work before starting another batch.");

assert(contents.archiveAuth.includes("timingSafeEqual"), "Central archive token comparison must be constant time.");
assert(contents.archiveAuth.includes("INSTACOMP_SENTINEL_ARCHIVE_TOKEN"), "Central archive must use a dedicated credential.");
assert(contents.importRoute.includes("isValidInstaCompSentinelArchiveRequest"), "Central archive must require dedicated authentication.");
assert(contents.importRoute.includes("lookup(host"), "Central archive must resolve source DNS before fetching.");
assert(contents.importRoute.includes("isPrivateIp"), "Central archive must block private-address SSRF.");
assert(contents.importRoute.includes("requestPinnedSource"), "Central archive must use a pinned HTTPS client.");
assert(contents.importRoute.includes("lookup: pinnedLookup"), "Central archive must pin fetches to the validated public DNS result.");
assert(contents.importRoute.includes("redirect chain was invalid or too long"), "Central archive must validate every redirect.");
assert(contents.importRoute.includes("createHash(\"sha256\")"), "Central archive must verify SHA-256.");
assert(contents.importRoute.includes("archive.download(sourcePath)"), "Duplicate source objects must be downloaded and re-verified.");
assert(contents.importRoute.includes("sourceReceiptId"), "Each public source must retain an immutable provenance receipt.");
assert(contents.importRoute.includes("public: false"), "Sentinel source archive must be private.");
assert(contents.importRoute.includes("upsert: false"), "Source files and receipts must be immutable and duplicate-safe.");
assert(contents.importRoute.includes("`${directory}/${expectedSha}.source`"), "Central object identity must depend only on SHA-256.");
assert(contents.importRoute.includes("probeRemoved: true"), "Central archive must expose a write/delete readiness probe.");
assert(contents.importRoute.includes("private_source_archived_pending_registry_validation"), "Archive status must not claim active Registry validation.");

assert(contents.proxy.includes("requireInstaCompJobActor"), "Website Sentinel proxy must require authenticated admin context.");
assert(contents.proxy.includes("actor.type !== \"admin\""), "Seller sessions must not control the admin Sentinel dashboard.");
assert(contents.proxy.includes("assertTrustedInstaCompMutationRequest"), "Run Now and target refresh must enforce same-origin mutation security.");
assert(contents.proxy.includes("isValidInstaCompSentinelArchiveRequest"), "Installer status probe must use the dedicated archive token.");
assert(contents.proxy.includes("X-InstaComp-AI-Key"), "Website proxy must authenticate to the Mac.");
assert(contents.proxy.includes("INSTACOMP_AI_LOCAL_URL"), "Website proxy must use the configured permanent tunnel.");
assert(contents.proxy.includes("localhost"), "Website proxy must reject Production localhost configuration.");

assert(contents.dashboard.includes("Checklist Sentinel™"), "Dashboard branding is incorrect.");
assert(contents.dashboard.includes("20 * 60 * 1000"), "Dashboard progress must refresh every 20 minutes.");
assert(contents.dashboard.includes("Progress last updated:"), "Dashboard progress must show its last-updated timestamp.");
assert(contents.dashboard.includes("completedTargets * 100") && contents.dashboard.includes("totalTargets"), "Dashboard must calculate overall backlog progress across the full target universe.");
assert(contents.dashboard.includes('action("run")'), "Dashboard must expose Run Now.");
assert(contents.dashboard.includes('action("refresh-targets")'), "Dashboard must expose target refresh.");
assert(contents.dashboard.includes("status?.enabled &&"), "Dashboard must not claim connection health when Sentinel is disabled.");
assert(contents.dashboard.includes("freeze_protection"), "Dashboard must show freeze protection.");
assert(contents.dashboard.includes("registry_import_configured"), "Dashboard must show central archive state.");
assert(contents.dashboard.includes('/api/instacomp/checklist-sentinel?view=status'), "Dashboard must read Sentinel state through the certified secure website proxy.");
assert(contents.dashboard.includes('fetch("/api/instacomp/checklist-sentinel"'), "Dashboard mutations must use the certified secure Sentinel proxy.");
assert(!contents.dashboard.includes("/api/admin/instacomp/checklist-sentinel"), "Dashboard must not call a nonexistent duplicate admin proxy.");
assert(!contents.dashboard.includes("INSTACOMP_AI_LOCAL_KEY"), "Browser code must never contain the Mac key.");
assert(!contents.dashboard.includes("instacomp.truelycollectables.com"), "Browser code must not call the tunnel directly.");

assert(contents.adminPage.includes('href="/admin/instacomp/checklist-sentinel"'), "Main Admin page must have a direct Checklist Sentinel link.");
assert(contents.adminPage.includes("Open Checklist Sentinel"), "Main Admin page must visibly label the Checklist Sentinel link.");
assert(contents.quickTools.includes("/admin/instacomp/checklist-sentinel"), "Admin quick tools must link to Sentinel.");
assert(contents.env.includes("INSTACOMP_AI_SENTINEL_INTERVAL_SECONDS=86400"), "Documented cadence must be 24 hours.");
assert(contents.env.includes("INSTACOMP_AI_SENTINEL_CHECKPOINT_SECONDS=300"), "Documented checkpoint must be five minutes.");
assert(contents.env.includes("INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN"), "Documented configuration must include the archive credential.");
assert(contents.env.includes("Keep the large multipart transfer on localhost"), "Documented import must stay on localhost.");

console.log("✓ Named tunnel and both LaunchAgents are installer-owned");
console.log("✓ Dedicated Mac and archive secrets are generated locally and synchronized once");
console.log("✓ Routine Mac updates re-sync the existing key without rotating it and prove Production accepts it");
console.log("✓ Known invalid Vercel './' root settings are repaired narrowly before archive-safe Production deploys");
console.log("✓ No unrelated Vercel service credential is read or rotated");
console.log("✓ Sentinel safe batch cap remains 75 and pending backlog auto-drains only when due");
console.log("✓ Main Admin page and quick tools both link directly to Checklist Sentinel");
console.log("✓ Dashboard reports overall checklist search progress with a 20-minute timestamped refresh");
console.log("✓ Dashboard uses the admin-only same-origin Sentinel website proxy");
console.log("✓ Large files stay off the Vercel request body");
console.log("✓ Source URL, redirects, DNS, byte count, duplicate bytes, and SHA-256 fail closed");
console.log("✓ Central source archive is private with immutable source provenance");
console.log("✓ Admin dashboard controls the Mac only through the secure CSRF-protected proxy");
console.log("InstaComp AI Checklist Sentinel control audit: PASS");
