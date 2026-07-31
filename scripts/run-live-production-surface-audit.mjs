import assert from "node:assert/strict";

const origin = String(
  process.env.TCOS_AUDIT_ORIGIN || "https://truelycollectables.com",
).replace(/\/+$/, "");

const ERROR_PATTERNS = [
  /error loading/i,
  /permission denied/i,
  /internal server error/i,
  /application error/i,
  /this page could not be found/i,
  /unhandled runtime error/i,
];

const pages = [
  ["/", /Find the collectible/i],
  ["/shop", /Shop Sports Cards|Live inventory and recent sales/i],
  ["/cart", /Shopping Cart/i],
  ["/account", /Collector Account/i],
  ["/shipping", /Shipping Policy|Shipping/i],
  ["/buyer-protection", /Shipment Protection|Buyer Protection/i],
  ["/returns", /Returns & Refunds/i],
  ["/privacy", /Privacy Policy/i],
  ["/terms", /Terms of Service/i],
  ["/contact", /Contact Truely Collectables|Contact/i],
];

async function fetchText(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  const text = await response.text();
  return { response, text };
}

for (const [path, expected] of pages) {
  const { response, text } = await fetchText(path);
  assert.equal(
    response.status,
    200,
    `${path} returned HTTP ${response.status} (${response.url})`,
  );
  assert.match(text, expected, `${path} is missing its expected public content.`);
  for (const pattern of ERROR_PATTERNS) {
    assert.doesNotMatch(text, pattern, `${path} leaked public error text: ${pattern}`);
  }
  console.log(`PASS ${path} ${response.status}`);
}

const { response: homeResponse } = await fetchText("/");
const headers = homeResponse.headers;
const csp = headers.get("content-security-policy") || "";
assert.ok(csp.includes("frame-ancestors"), "CSP must define frame-ancestors.");
assert.equal(
  headers.get("x-content-type-options"),
  "nosniff",
  "X-Content-Type-Options must be nosniff.",
);
assert.ok(
  (headers.get("strict-transport-security") || "").includes("max-age="),
  "Strict-Transport-Security must be enabled.",
);
assert.ok(headers.get("referrer-policy"), "Referrer-Policy must be set.");
assert.ok(headers.get("permissions-policy"), "Permissions-Policy must be set.");
assert.ok(
  headers.get("x-frame-options") === "DENY" || csp.includes("frame-ancestors 'none'"),
  "Clickjacking protection must deny framing.",
);
console.log("PASS public security headers");

const robots = await fetchText("/robots.txt");
assert.equal(robots.response.status, 200, "robots.txt must return 200.");
assert.match(robots.text, /User-agent:/i);
assert.match(robots.text, /Sitemap:/i);
assert.doesNotMatch(robots.text, /Allow:\s*\/admin/i);
console.log("PASS robots.txt");

const sitemap = await fetchText("/sitemap.xml");
assert.equal(sitemap.response.status, 200, "sitemap.xml must return 200.");
assert.match(sitemap.text, /<urlset|<sitemapindex/i);
assert.match(sitemap.text, /truelycollectables\.com\/shop/i);
console.log("PASS sitemap.xml");

const admin = await fetchText("/admin");
assert.equal(admin.response.status, 200, "Unauthenticated /admin must resolve to a login surface.");
assert.ok(
  admin.response.url.includes("/admin/login") || /admin login|sign in/i.test(admin.text),
  "Unauthenticated /admin must redirect to or render the admin login page.",
);
assert.doesNotMatch(admin.text, /Launch Readiness|Financial Reconciliation|Seller Payouts/i);
console.log("PASS unauthenticated admin boundary");

const checkoutGet = await fetchText("/api/checkout");
assert.ok(
  [400, 404, 405, 503].includes(checkoutGet.response.status),
  `GET /api/checkout returned unexpected status ${checkoutGet.response.status}.`,
);
assert.doesNotMatch(
  checkoutGet.text,
  /SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|sk_live_|whsec_/i,
  "Checkout error responses must never expose secrets.",
);
console.log(`PASS checkout public boundary ${checkoutGet.response.status}`);

console.log("Live production surface audit passed.");
