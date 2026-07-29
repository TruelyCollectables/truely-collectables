from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# Complete the admin command-center route map.
replace_once(
    "src/app/admin/page.tsx",
    '        { href: "/admin/ebay/duplicates", label: "Duplicate Cleanup" },\n',
    '        { href: "/admin/ebay/duplicates", label: "Duplicate Cleanup" },\n'
    '        { href: "/admin/ebay/launch-ready-sync", label: "Launch Ready Sync" },\n',
)
replace_once(
    "src/app/admin/page.tsx",
    '        { href: "/admin/inventory/category-review", label: "Category Review" },\n',
    '        { href: "/admin/inventory/category-review", label: "Category Review" },\n'
    '        { href: "/admin/verified-reference-import", label: "Verified Import" },\n',
)
replace_once(
    "src/app/admin/page.tsx",
    '        { href: "/admin/seller-payouts", label: "Seller Payouts" },\n',
    '        { href: "/admin/seller-payouts", label: "Seller Payouts" },\n'
    '        { href: "/admin/buyer-protection", label: "Buyer Protection" },\n',
)
replace_once(
    "src/app/admin/page.tsx",
    '        { href: "/admin/order-review-cases", label: "Review Cases" },\n',
    '        { href: "/admin/order-review-cases", label: "Review Cases" },\n'
    '        { href: "/admin/order-notifications", label: "Order Notifications" },\n',
)

# Make every static admin page part of the runtime smoke inventory. Recovery is public by design.
replace_once(
    "scripts/smoke-admin-runtime.mjs",
    '''  {
    path: "/admin/login",
    auth: false,
    expectedText: "Admin password",
  },
''',
    '''  {
    path: "/admin/login",
    auth: false,
    expectedText: "Admin password",
  },
  {
    path: "/admin/reset-password",
    auth: false,
    expectedText: "Choose a permanent admin password",
  },
''',
)
replace_once(
    "scripts/smoke-admin-runtime.mjs",
    '''  {
    path: "/admin/ebay/duplicates",
    auth: true,
    expectedText: "Duplicate cleanup queue",
  },
''',
    '''  {
    path: "/admin/ebay/duplicates",
    auth: true,
    expectedText: "Duplicate cleanup queue",
  },
  {
    path: "/admin/ebay/launch-ready-sync",
    auth: true,
    expectedText: "eBay Launch Readiness",
  },
''',
)
replace_once(
    "scripts/smoke-admin-runtime.mjs",
    '''  {
    path: "/admin/financial-reconciliation",
    auth: true,
    expectedText: "Stripe Reconciliation",
  },
''',
    '''  {
    path: "/admin/financial-reconciliation",
    auth: true,
    expectedText: "Stripe Reconciliation",
  },
  {
    path: "/admin/buyer-protection",
    auth: true,
    expectedText: "Buyer Protection Claims",
  },
''',
)
replace_once(
    "scripts/smoke-admin-runtime.mjs",
    '''  {
    path: "/admin/orders",
    auth: true,
    expectedText: "Orders",
  },
''',
    '''  {
    path: "/admin/orders",
    auth: true,
    expectedText: "Orders",
  },
  {
    path: "/admin/order-notifications",
    auth: true,
    expectedText: "Order Notification Delivery",
  },
''',
)
replace_once(
    "scripts/smoke-admin-runtime.mjs",
    '''  {
    path: "/admin/quick-list",
    auth: true,
    expectedText: "Accuracy Council + InstaComp™",
  },
''',
    '''  {
    path: "/admin/quick-list",
    auth: true,
    expectedText: "Accuracy Council + InstaComp™",
  },
  {
    path: "/admin/verified-reference-import",
    auth: true,
    expectedText: "Verified Reference",
  },
''',
)

replace_once(
    "scripts/run-admin-dashboard-actions-simulations.mjs",
    'const adminDashboardLinkExemptions = new Set(["/admin", "/admin/login"]);\nconst adminNoDeadEndExemptions = new Set(["/admin", "/admin/login"]);',
    'const adminDashboardLinkExemptions = new Set([\n  "/admin",\n  "/admin/login",\n  "/admin/reset-password",\n]);\nconst adminNoDeadEndExemptions = new Set([\n  "/admin",\n  "/admin/login",\n  "/admin/reset-password",\n]);',
)
replace_once(
    "src/app/admin/order-notifications/page.tsx",
    '      <div className="mx-auto max-w-7xl space-y-6">',
    '      <div className="mx-auto max-w-[1600px] space-y-6">',
)

# Repair the shipping contract tests and restore explicit seller-protection evidence terms.
replace_once(
    "src/lib/shipping-simulations.ts",
    '''  const overThreeOunces = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 4,
    subtotal: 19,
  });''',
    '''  const overThreeOunces = resolveShippingMethod({
    requestedMethod: "STANDARD_ENVELOPE",
    itemCount: 5,
    subtotal: 19,
  });''',
)
replace_once(
    "src/lib/shipping-simulations.ts",
    '      "A raw-card order estimated above 3 oz is forced from Standard Envelope to Ground Advantage.",',
    '      "A five-card raw-card order estimates above 3 oz and is forced from Standard Envelope to Ground Advantage.",',
)
replace_once(
    "src/lib/shipping-simulations.ts",
    '          "Order row was not found for this Standard Envelope label. (1)",',
    '          "Order row was not found for this Tracked Card Letter label. (1)",',
)
replace_once(
    "src/lib/lettertrack-export.ts",
    '      sellerProtectionProgram: "Truely Collectables Under-$20 Seller Protection",',
    '      sellerProtectionProgram: "TCOS Under-$20 Seller Protection",',
)
replace_once(
    "src/lib/lettertrack-export.ts",
    '      sellerProtectionOptInRequired: "store program rules apply",',
    '      sellerProtectionOptInRequired:\n        "seller must opt in before the order qualifies",',
)
replace_once(
    "src/lib/lettertrack-export.ts",
    '''      deliveryEvidenceRequirement:
        "USPS IMb / LetterTrack scans are limited and may be incomplete. Record the available scan trail and any delivery-related status for support review.",''',
    '''      deliveryEvidenceRequirement:
        "Record the LetterTrack status and available USPS IMb scan trail for support review. Scan visibility is limited and may be incomplete.",''',
)

# Verify the delegated payment posture source rather than demanding a duplicated literal in the page.
replace_once(
    "scripts/run-admin-live-launch-gate-simulations.mjs",
    '''  paymentPage: await readFile(
    new URL("../src/app/admin/live-payment-launch/page.tsx", import.meta.url),
    "utf8",
  ),''',
    '''  paymentPage: await readFile(
    new URL("../src/app/admin/live-payment-launch/page.tsx", import.meta.url),
    "utf8",
  ),
  paymentStatus: await readFile(
    new URL(
      "../src/lib/live-payment-status-presentation.ts",
      import.meta.url,
    ),
    "utf8",
  ),''',
)
replace_once(
    "scripts/run-admin-live-launch-gate-simulations.mjs",
    '    "NOT APPROVABLE",\n',
    '',
)
replace_once(
    "scripts/run-admin-live-launch-gate-simulations.mjs",
    '''  for (const fragment of [
    "const shippingGatePosture =",''',
    '''  assert(
    sources.paymentStatus.includes('status: "NOT APPROVABLE"'),
    "Expected delegated live-payment status presentation to expose NOT APPROVABLE.",
  );

  for (const fragment of [
    "const shippingGatePosture =",''',
)

# Give every shop filter an accessible name.
replace_once(
    "src/app/shop/page.tsx",
    '''        <select
          name="section"''',
    '''        <select
          aria-label="Filter by section"
          name="section"''',
)
replace_once(
    "src/app/shop/page.tsx",
    '''        <select
          name="feature"''',
    '''        <select
          aria-label="Filter by collectible feature"
          name="feature"''',
)
replace_once(
    "src/app/shop/page.tsx",
    '''        <select
          name="sort"''',
    '''        <select
          aria-label="Sort shop results"
          name="sort"''',
)

# Improve homepage cacheability and image delivery without hiding current inventory.
replace_once(
    "src/app/page.tsx",
    'export const dynamic = "force-dynamic";\nexport const revalidate = 0;',
    'export const revalidate = 300;',
)
replace_once(
    "src/app/page.tsx",
    '''function CardImage({ card, sizes }: { card: UniversalInventoryItem; sizes: string }) {
  return (
    <Image
      src={card.imageUrl || "/placeholder.png"}
      alt={card.title}
      fill
      unoptimized
      sizes={sizes}''',
    '''function CardImage({
  card,
  sizes,
  priority = false,
}: {
  card: UniversalInventoryItem;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={card.imageUrl || "/placeholder.png"}
      alt={card.title}
      fill
      priority={priority}
      sizes={sizes}''',
)
replace_once(
    "src/app/page.tsx",
    '''  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);
  let products: UniversalInventoryItem[] = [];

  try {
    products = await createServerInventoryEngine().listAvailable();
  } catch (error) {
    console.error("Homepage inventory load failed:", error);
  }
''',
    '''  const supabase = createSupabaseServerClient();
  const [storeSettings, products] = await Promise.all([
    getStoreSettings(supabase),
    createServerInventoryEngine()
      .listAvailable()
      .catch((error) => {
        console.error("Homepage inventory load failed:", error);
        return [] as UniversalInventoryItem[];
      }),
  ]);
''',
)
replace_once(
    "src/app/page.tsx",
    '<CardImage card={card} sizes="220px" />',
    '<CardImage card={card} sizes="220px" priority={index === 0} />',
)

# Canonical URLs remain explicit while utility/account routes stay intentionally no-index.
replace_once(
    "src/app/cart/page.tsx",
    '''  robots: {
    index: false,
    follow: false,
  },
};''',
    '''  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/cart",
  },
};''',
)
write(
    "src/app/account/signup/layout.tsx",
    '''import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Buyer Account",
  description:
    "Create a Truely Collectables buyer account to track purchases and manage your collection. No payment card is required to register.",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/account/signup",
  },
};

export default function BuyerSignupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
''',
)

# Permanent regression proving the shared privilege boundaries that the generic scanner missed.
write(
    "scripts/run-privileged-route-auth-regressions.mjs",
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const proxy = await read("src/proxy.ts");
const actorGuard = await read("src/lib/instacomp-job-server.ts");
const sellerPage = await read("src/app/seller/page.tsx");

for (const fragment of [
  'pathname.startsWith("/api/ebay")',
  'pathname.startsWith("/api/orders")',
  'pathname.startsWith("/admin")',
  'isValidAdminSessionValue',
]) {
  assert.match(proxy, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")));
}

for (const fragment of [
  "export async function requireInstaCompJobActor",
  "isValidInstaCompServiceRequest(request)",
  "bearerToken(request)",
  '.eq("role", "seller")',
  '.eq("status", "active")',
  "isValidAdminSessionValue(adminSession)",
  "INSTACOMP_JOB_UNAUTHORIZED",
]) {
  assert.ok(actorGuard.includes(fragment), `Missing shared InstaComp privilege guard: ${fragment}`);
}

const actorGuardedRoutes = [
  "src/app/api/account/seller/quick-list/route.ts",
  "src/app/api/instacomp/draft-listings/route.ts",
  "src/app/api/instacomp/jobs/route.ts",
  "src/app/api/instacomp/jobs/[id]/route.ts",
  "src/app/api/instacomp/jobs/[id]/items/route.ts",
  "src/app/api/instacomp/jobs/[id]/items/[itemId]/route.ts",
  "src/app/api/instacomp/jobs/[id]/knowledge-base/route.ts",
  "src/app/api/instacomp/trade-items/route.ts",
];
for (const path of actorGuardedRoutes) {
  const source = await read(path);
  assert.ok(
    source.includes("requireInstaCompJobActor") &&
      source.includes("await requireInstaCompJobActor(request)"),
    `${path} must invoke the shared seller/admin actor guard.`,
  );
}

assert.ok(
  sellerPage.includes("if (!session)") &&
    sellerPage.includes("Log in through your TCOS account first"),
  "The public seller shell must stop before loading private seller data.",
);

console.log("Privileged route authorization regressions passed.");
''',
)
replace_once(
    "package.json",
    '    "simulate:admin-login": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/run-admin-login-simulations.mjs",\n',
    '    "simulate:admin-login": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/run-admin-login-simulations.mjs",\n'
    '    "simulate:privileged-route-auth": "node scripts/run-privileged-route-auth-regressions.mjs",\n',
)

print("Full launch remediation patch applied.")
