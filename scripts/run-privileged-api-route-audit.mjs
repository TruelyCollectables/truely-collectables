import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();
const apiRoot = path.join(repositoryRoot, "src/app/api");
const proxyPath = path.join(repositoryRoot, "src/proxy.ts");
const instaCompActorPath = path.join(repositoryRoot, "src/lib/instacomp-job-server.ts");
const marketplaceTokenCryptoPath = path.join(
  repositoryRoot,
  "src/lib/marketplace-token-crypto.ts",
);
const adminEbayAuthPath = path.join(
  repositoryRoot,
  "src/app/api/ebay/auth/route.ts",
);
const ebayCallbackPath = path.join(
  repositoryRoot,
  "src/app/api/ebay/callback/route.ts",
);
const reportPath = path.join(repositoryRoot, "privileged-api-route-audit.json");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function source(file) {
  return fs.readFileSync(file, "utf8");
}

function routePath(file) {
  const relative = path.relative(apiRoot, path.dirname(file)).split(path.sep).join("/");
  return relative ? `/api/${relative}` : "/api";
}

function routeMethods(content) {
  const methods = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*\(/g,
    /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*=/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) methods.add(match[1]);
    }
  }

  return Array.from(methods).sort();
}

const privilegedPatterns = [
  [
    "admin Supabase client",
    /createSupabaseServerClient\s*\(\s*\{[\s\S]{0,120}?admin\s*:\s*true[\s\S]{0,120}?\}\s*\)/,
  ],
  ["service-role environment key", /SUPABASE_SERVICE_ROLE_KEY/],
  ["service-role literal", /service[_-]?role/i],
  ["public inventory engine with trusted database access", /createServerInventoryEngine\s*\(/],
  ["shared trusted inventory singleton", /\binventoryEngine\s*\./],
  ["admin database alias", /\b(?:supabaseAdmin|adminSupabase|serviceRoleClient)\b/],
];

function privilegedSignals(content) {
  return privilegedPatterns
    .filter(([, pattern]) => pattern.test(content))
    .map(([label]) => label);
}

function proxyProtected(route) {
  if (route.startsWith("/api/admin/") && route !== "/api/admin/login") {
    return "admin proxy namespace";
  }

  if (
    route.startsWith("/api/ebay/") &&
    route !== "/api/ebay/callback" &&
    route !== "/api/ebay/notifications"
  ) {
    return "eBay admin proxy namespace";
  }

  if (route.startsWith("/api/orders/")) {
    return "orders admin proxy namespace";
  }

  if (route === "/api/offers/update-status" || route === "/api/offers/counter") {
    return "offer-decision admin proxy rule";
  }

  return null;
}

function called(content, name) {
  return new RegExp(`\\b${name}\\s*\\(`).test(content);
}

function explicitProtection(route, content, methods) {
  if (route === "/api/checkout") {
    const checkoutGuards =
      methods.length === 1 &&
      methods[0] === "POST" &&
      called(content, "checkPublicEndpointRateLimit") &&
      called(content, "getStripePaymentRuntime") &&
      /requireAvailableCartItems\s*\(/.test(content);
    return checkoutGuards ? "explicit public checkout guard contract" : null;
  }

  if (route === "/api/offers/create") {
    const offerGuards =
      methods.length === 1 &&
      methods[0] === "POST" &&
      called(content, "checkPublicEndpointRateLimit") &&
      /requireAvailableCartItems\s*\(/.test(content) &&
      called(content, "recordTermsAcceptance");
    return offerGuards ? "explicit public offer guard contract" : null;
  }

  if (route === "/api/ebay/callback") {
    const ebayCallbackGuards =
      methods.length === 1 &&
      methods[0] === "GET" &&
      called(content, "parseSellerMarketplaceOAuthState") &&
      called(content, "parseAdminMarketplaceOAuthState") &&
      /if\s*\(!state\)/.test(content) &&
      /parseOAuthActor\s*\(state, storeId\)/.test(content) &&
      /store_id:\s*actor\.state\.storeId/.test(content);
    return ebayCallbackGuards
      ? "signed seller-or-admin eBay OAuth state validation"
      : null;
  }

  if (route === "/api/storefront/product-images/[id]") {
    const storefrontImageGuards =
      methods.length === 1 &&
      methods[0] === "GET" &&
      called(content, "createServerInventoryEngine") &&
      /getByLegacyProductId\s*\(/.test(content) &&
      /inventoryItemId/.test(content) &&
      /selectFrontBackListingImages\s*\(/.test(content);
    return storefrontImageGuards
      ? "explicit launch-scoped public product-image read contract"
      : null;
  }

  if (called(content, "requireInstaCompJobActor")) {
    return "verified InstaComp seller-or-admin actor validation";
  }

  const accountAuth = called(content, "getAuthenticatedAccountFromRequest");
  const publicRateLimit = called(content, "checkPublicEndpointRateLimit");
  const adminSession =
    called(content, "isValidAdminSessionValue") ||
    called(content, "requireAdminSession") ||
    called(content, "requireAdmin");
  const cronSecret =
    content.includes("CRON_SECRET") &&
    (/authorization/i.test(content) || called(content, "validCronAuthorization"));
  const timingSafeBearer =
    /authorization/i.test(content) &&
    (/timingSafeEqual/.test(content) || /Bearer\s+\$\{/.test(content));
  const stripeSignature =
    /stripe-signature/i.test(content) &&
    (/constructEvent(?:Async)?\s*\(/.test(content) || /webhooks\.constructEvent/.test(content));
  const signedWebhook =
    /signature/i.test(content) &&
    /(verify|timingSafeEqual|createHmac|subtle\.verify)/i.test(content);

  if (adminSession) return "route-level admin session validation";
  if (accountAuth) return "authenticated account validation";
  if (publicRateLimit) return "public endpoint rate limiting and identity validation";
  if (cronSecret) return "cron bearer-secret validation";
  if (stripeSignature) return "Stripe webhook signature validation";
  if (signedWebhook) return "signed webhook validation";
  if (timingSafeBearer) return "timing-safe bearer authorization";

  return null;
}

for (const requiredPath of [
  apiRoot,
  proxyPath,
  instaCompActorPath,
  marketplaceTokenCryptoPath,
  adminEbayAuthPath,
  ebayCallbackPath,
]) {
  assert.ok(fs.existsSync(requiredPath), `Required security source is missing: ${requiredPath}`);
}

const proxySource = source(proxyPath);
for (const [name, pattern] of [
  ["admin namespace", /pathname\.startsWith\("\/api\/admin"\)/],
  ["eBay namespace", /pathname\.startsWith\("\/api\/ebay"\)/],
  ["orders namespace", /pathname\.startsWith\("\/api\/orders"\)/],
  ["offer accept decisions", /pathname === "\/api\/offers\/update-status"/],
  ["offer counter decisions", /pathname === "\/api\/offers\/counter"/],
  ["signed admin handoff validation", /isValidAdminSessionValue\(adminHandoff\)/],
  ["admin cookie validation", /isValidAdminSessionValue\(adminCookie\)/],
]) {
  assert.match(proxySource, pattern, `Proxy protection is missing for ${name}.`);
}

const instaCompActorSource = source(instaCompActorPath);
for (const [name, pattern] of [
  ["service-role fail-closed check", /requireInstaCompJobSupabase\(\)/],
  ["bearer user validation", /supabase\.auth\.getUser\(token\)/],
  ["active seller membership", /\.eq\("role", "seller"\)[\s\S]*\.eq\("status", "active"\)/],
  ["signed admin cookie validation", /isValidAdminSessionValue\(adminSession\)/],
  ["unauthorized failure", /INSTACOMP_JOB_UNAUTHORIZED/],
]) {
  assert.match(
    instaCompActorSource,
    pattern,
    `InstaComp actor authentication is missing ${name}.`,
  );
}

const marketplaceTokenCryptoSource = source(marketplaceTokenCryptoPath);
for (const [name, pattern] of [
  ["HMAC state signature", /createHmac\("sha256", signingSecret\(\)\)/],
  ["timing-safe signature comparison", /timingSafeEqual\(expectedSignature, providedSignature\)/],
  ["seller state creation", /export function createSellerMarketplaceOAuthState/],
  ["seller state parsing", /export function parseSellerMarketplaceOAuthState/],
  ["admin state creation", /export function createAdminMarketplaceOAuthState/],
  ["admin state parsing", /export function parseAdminMarketplaceOAuthState/],
  ["state expiration", /expiresAt:\s*issuedAt \+ MARKETPLACE_OAUTH_STATE_TTL_SECONDS/],
]) {
  assert.match(
    marketplaceTokenCryptoSource,
    pattern,
    `Marketplace OAuth state protection is missing ${name}.`,
  );
}

const adminEbayAuthSource = source(adminEbayAuthPath);
for (const [name, pattern] of [
  ["signed admin state creation", /createAdminMarketplaceOAuthState\s*\(/],
  ["active store binding", /storeId,[\s\S]*provider:\s*"ebay"/],
  ["state query parameter", /&state=\$\{encodeURIComponent\(state\)\}/],
]) {
  assert.match(
    adminEbayAuthSource,
    pattern,
    `Admin eBay authorization is missing ${name}.`,
  );
}

const ebayCallbackSource = source(ebayCallbackPath);
for (const [name, pattern] of [
  ["missing-state rejection", /if\s*\(!state\)/],
  ["seller state parser", /parseSellerMarketplaceOAuthState\s*\(/],
  ["admin state parser", /parseAdminMarketplaceOAuthState\s*\(/],
  ["active-store state validation", /parseOAuthActor\s*\(state, storeId\)/],
  ["admin token store binding", /store_id:\s*actor\.state\.storeId/],
]) {
  assert.match(
    ebayCallbackSource,
    pattern,
    `eBay callback is missing ${name}.`,
  );
}

const routeFiles = walk(apiRoot).filter((file) => file.endsWith(`${path.sep}route.ts`));
const audits = [];

for (const file of routeFiles) {
  const content = source(file);
  const methods = routeMethods(content);
  if (methods.length === 0) continue;

  const signals = privilegedSignals(content);
  if (signals.length === 0) continue;

  const route = routePath(file);
  const protection =
    proxyProtected(route) || explicitProtection(route, content, methods);

  audits.push({
    file: path.relative(repositoryRoot, file).split(path.sep).join("/"),
    route,
    methods,
    privilegedSignals: signals,
    protection,
  });
}

const unsafe = audits.filter((audit) => !audit.protection);
const report = {
  generatedAt: new Date().toISOString(),
  routeFilesScanned: routeFiles.length,
  privilegedRoutes: audits.length,
  protectedRoutes: audits.length - unsafe.length,
  unsafeRoutes: unsafe.length,
  audits,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const audit of audits) {
  console.log(
    `${audit.protection ? "PASS" : "FAIL"} ${audit.methods.join("/")} ${audit.route} :: ${
      audit.protection || "no recognized protection"
    } :: ${audit.privilegedSignals.join(", ")}`,
  );
}

if (unsafe.length > 0) {
  const details = unsafe
    .map(
      (audit) =>
        `- ${audit.file} (${audit.methods.join(", ")}; ${audit.privilegedSignals.join(", ")})`,
    )
    .join("\n");

  throw new Error(
    `Privileged API routes lack a recognized protection contract:\n${details}`,
  );
}

console.log(
  `Privileged API route audit passed: ${audits.length} protected route${
    audits.length === 1 ? "" : "s"
  } checked across ${routeFiles.length} API route files.`,
);
