import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();
const apiRoot = path.join(repositoryRoot, "src/app/api");
const proxyPath = path.join(repositoryRoot, "src/proxy.ts");

type RouteAudit = {
  file: string;
  route: string;
  methods: string[];
  privilegedSignals: string[];
  protection: string | null;
};

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function source(file: string) {
  return fs.readFileSync(file, "utf8");
}

function routePath(file: string) {
  const relative = path.relative(apiRoot, path.dirname(file)).split(path.sep).join("/");
  return relative ? `/api/${relative}` : "/api";
}

function mutationMethods(content: string) {
  const methods = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\s*\(/g,
    /export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) methods.add(match[1]);
    }
  }

  return Array.from(methods).sort();
}

const privilegedPatterns: Array<[string, RegExp]> = [
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

function privilegedSignals(content: string) {
  return privilegedPatterns
    .filter(([, pattern]) => pattern.test(content))
    .map(([label]) => label);
}

function proxyProtected(route: string) {
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

function called(content: string, name: string) {
  return new RegExp(`\\b${name}\\s*\\(`).test(content);
}

function explicitProtection(route: string, content: string) {
  if (route === "/api/checkout") {
    const checkoutGuards =
      called(content, "checkPublicEndpointRateLimit") &&
      called(content, "getStripePaymentRuntime") &&
      /requireAvailableCartItems\s*\(/.test(content);
    return checkoutGuards ? "explicit public checkout guard contract" : null;
  }

  if (route === "/api/offers/create") {
    const offerGuards =
      called(content, "checkPublicEndpointRateLimit") &&
      /requireAvailableCartItems\s*\(/.test(content) &&
      called(content, "recordTermsAcceptance");
    return offerGuards ? "explicit public offer guard contract" : null;
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

assert.ok(fs.existsSync(apiRoot), "API route root is missing.");
assert.ok(fs.existsSync(proxyPath), "src/proxy.ts is missing.");

const proxySource = source(proxyPath);
for (const [name, pattern] of [
  ["admin namespace", /pathname\.startsWith\("\/api\/admin"\)/],
  ["eBay namespace", /pathname\.startsWith\("\/api\/ebay"\)/],
  ["orders namespace", /pathname\.startsWith\("\/api\/orders"\)/],
  ["offer accept decisions", /pathname === "\/api\/offers\/update-status"/],
  ["offer counter decisions", /pathname === "\/api\/offers\/counter"/],
  ["signed admin handoff validation", /isValidAdminSessionValue\(adminHandoff\)/],
  ["admin cookie validation", /isValidAdminSessionValue\(adminCookie\)/],
] as const) {
  assert.match(proxySource, pattern, `Proxy protection is missing for ${name}.`);
}

const routeFiles = walk(apiRoot).filter((file) => file.endsWith(`${path.sep}route.ts`));
const audits: RouteAudit[] = [];

for (const file of routeFiles) {
  const content = source(file);
  const methods = mutationMethods(content);
  if (methods.length === 0) continue;

  const signals = privilegedSignals(content);
  if (signals.length === 0) continue;

  const route = routePath(file);
  const protection = proxyProtected(route) || explicitProtection(route, content);

  audits.push({
    file: path.relative(repositoryRoot, file).split(path.sep).join("/"),
    route,
    methods,
    privilegedSignals: signals,
    protection,
  });
}

const unsafe = audits.filter((audit) => !audit.protection);

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
    `Privileged mutation routes lack a recognized protection contract:\n${details}`,
  );
}

console.log(
  `Privileged API route audit passed: ${audits.length} protected mutation route${
    audits.length === 1 ? "" : "s"
  } checked across ${routeFiles.length} API route files.`,
);
