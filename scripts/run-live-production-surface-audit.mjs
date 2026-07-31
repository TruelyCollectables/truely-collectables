const origin = String(
  process.env.TCOS_AUDIT_ORIGIN || "https://truelycollectables.com",
).replace(/\/+$/, "");

const ERROR_PATTERNS = [
  /error loading/i,
  /permission denied/i,
  /internal server error/i,
  /application error/i,
  /unhandled runtime error/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /STRIPE_SECRET_KEY/i,
  /sk_live_[a-zA-Z0-9]/,
  /whsec_[a-zA-Z0-9]/,
];

const pages = [
  ["/", /Find the collectible/i],
  ["/shop", /Shop Sports Cards|Live inventory and recent sales/i],
  ["/recently-sold", /Recently Sold/i],
  ["/cart", /Shopping Cart/i],
  ["/account", /Collector Account/i],
  ["/account/orders", /Orders|Log In/i],
  ["/shipping", /Shipping Policy|Shipping/i],
  ["/buyer-protection", /Shipment Protection|Buyer Protection/i],
  ["/returns", /Returns & Refunds/i],
  ["/privacy", /Privacy Policy/i],
  ["/terms", /Terms of Service/i],
  ["/contact", /Contact Truely Collectables|Contact/i],
];

const failures = [];
const results = [];

function pass(label, detail = "") {
  results.push({ status: "PASS", label, detail });
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail) {
  failures.push({ label, detail });
  results.push({ status: "FAIL", label, detail });
  console.error(`FAIL ${label} — ${detail}`);
}

function check(condition, label, detail) {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

async function fetchUrl(url, init = {}) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      ...init,
    });
    const text = await response.text();
    return { response, text, error: null };
  } catch (error) {
    return {
      response: null,
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchText(path, init = {}) {
  return fetchUrl(`${origin}${path}`, init);
}

const pageBodies = new Map();
for (const [path, expected] of pages) {
  const result = await fetchText(path);
  if (result.error || !result.response) {
    fail(path, `request failed: ${result.error || "no response"}`);
    continue;
  }

  pageBodies.set(path, result.text);
  check(
    result.response.status === 200,
    `${path} HTTP status`,
    `${result.response.status} (${result.response.url})`,
  );
  check(
    expected.test(result.text),
    `${path} expected content`,
    expected.toString(),
  );

  for (const pattern of ERROR_PATTERNS) {
    check(
      !pattern.test(result.text),
      `${path} public error/secret check`,
      pattern.toString(),
    );
  }
}

const homeText = pageBodies.get("/") || "";
const productIds = Array.from(
  new Set(
    Array.from(homeText.matchAll(/href=["']\/product\/(\d+)/g), (match) =>
      Number(match[1]),
    ).filter((value) => Number.isInteger(value) && value > 0),
  ),
).slice(0, 3);
check(productIds.length > 0, "homepage product links", `${productIds.length} found`);

for (const productId of productIds) {
  const product = await fetchText(`/product/${productId}`);
  if (product.error || !product.response) {
    fail(`/product/${productId}`, product.error || "no response");
    continue;
  }
  check(
    product.response.status === 200,
    `/product/${productId} HTTP status`,
    String(product.response.status),
  );
  check(
    /Add to Cart|Shoot Me an Offer|Out of Stock/i.test(product.text),
    `/product/${productId} commerce controls`,
    "purchase, offer, or sold-state control",
  );
  for (const pattern of ERROR_PATTERNS) {
    check(
      !pattern.test(product.text),
      `/product/${productId} public error/secret check`,
      pattern.toString(),
    );
  }
}

const home = await fetchText("/");
if (!home.response) {
  fail("public security headers", home.error || "home response unavailable");
} else {
  const headers = home.response.headers;
  const csp = headers.get("content-security-policy") || "";
  check(csp.includes("frame-ancestors"), "CSP frame-ancestors", csp || "missing");
  check(
    headers.get("x-content-type-options") === "nosniff",
    "X-Content-Type-Options",
    headers.get("x-content-type-options") || "missing",
  );
  check(
    (headers.get("strict-transport-security") || "").includes("max-age="),
    "Strict-Transport-Security",
    headers.get("strict-transport-security") || "missing",
  );
  check(
    Boolean(headers.get("referrer-policy")),
    "Referrer-Policy",
    headers.get("referrer-policy") || "missing",
  );
  check(
    Boolean(headers.get("permissions-policy")),
    "Permissions-Policy",
    headers.get("permissions-policy") || "missing",
  );
  check(
    headers.get("x-frame-options") === "DENY" ||
      csp.includes("frame-ancestors 'none'"),
    "clickjacking protection",
    headers.get("x-frame-options") || csp || "missing",
  );
}

const httpRedirect = await fetchUrl("http://truelycollectables.com/");
check(
  Boolean(httpRedirect.response?.url.startsWith("https://")),
  "HTTP to HTTPS redirect",
  httpRedirect.response?.url || httpRedirect.error || "missing",
);

const wwwRedirect = await fetchUrl("https://www.truelycollectables.com/");
check(
  Boolean(
    wwwRedirect.response &&
      new URL(wwwRedirect.response.url).hostname === "truelycollectables.com",
  ),
  "www canonical redirect",
  wwwRedirect.response?.url || wwwRedirect.error || "missing",
);

const robots = await fetchText("/robots.txt");
if (!robots.response) {
  fail("robots.txt", robots.error || "no response");
} else {
  check(robots.response.status === 200, "robots.txt HTTP status", String(robots.response.status));
  check(/User-agent:/i.test(robots.text), "robots.txt user agent", "User-agent present");
  check(/Sitemap:/i.test(robots.text), "robots.txt sitemap", "Sitemap present");
  check(!/Allow:\s*\/admin/i.test(robots.text), "robots.txt admin boundary", "admin not allowed");
}

const sitemap = await fetchText("/sitemap.xml");
if (!sitemap.response) {
  fail("sitemap.xml", sitemap.error || "no response");
} else {
  check(sitemap.response.status === 200, "sitemap.xml HTTP status", String(sitemap.response.status));
  check(/<urlset|<sitemapindex/i.test(sitemap.text), "sitemap.xml structure", "XML URL structure");
  check(/truelycollectables\.com\/shop/i.test(sitemap.text), "sitemap.xml shop URL", "shop present");
}

const admin = await fetchText("/admin");
if (!admin.response) {
  fail("unauthenticated admin boundary", admin.error || "no response");
} else {
  check(admin.response.status === 200, "unauthenticated /admin status", String(admin.response.status));
  check(
    admin.response.url.includes("/admin/login") || /admin login|sign in/i.test(admin.text),
    "unauthenticated admin login boundary",
    admin.response.url,
  );
  check(
    !/Launch Readiness|Financial Reconciliation|Seller Payouts/i.test(admin.text),
    "unauthenticated admin data exposure",
    "privileged dashboard text absent",
  );
}

const checkoutGet = await fetchText("/api/checkout");
if (!checkoutGet.response) {
  fail("checkout public boundary", checkoutGet.error || "no response");
} else {
  check(
    [400, 404, 405, 503].includes(checkoutGet.response.status),
    "GET /api/checkout status",
    String(checkoutGet.response.status),
  );
  check(
    !/SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|sk_live_|whsec_/i.test(
      checkoutGet.text,
    ),
    "checkout error secret exposure",
    "no credential markers",
  );
}

console.log(
  `Live production surface audit: ${results.filter((row) => row.status === "PASS").length} passed, ${failures.length} failed.`,
);

if (failures.length > 0) {
  console.error("Live production blockers:");
  for (const failure of failures) {
    console.error(`- ${failure.label}: ${failure.detail}`);
  }
  process.exitCode = 1;
} else {
  console.log("Live production surface audit passed.");
}
