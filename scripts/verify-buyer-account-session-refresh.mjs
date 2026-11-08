import assert from "node:assert/strict";
import fs from "node:fs";

const sessionSource = fs.readFileSync(
  "src/app/account/account-session.ts",
  "utf8",
);
const boundarySource = fs.readFileSync(
  "src/app/account/AccountSessionBoundary.tsx",
  "utf8",
);
const layoutSource = fs.readFileSync("src/app/account/layout.tsx", "utf8");
const ordersSource = fs.readFileSync(
  "src/app/account/orders/page.tsx",
  "utf8",
);
const navbarSource = fs.readFileSync(
  "src/app/components/Navbar.tsx",
  "utf8",
);
const mobileNavigationSource = fs.readFileSync(
  "src/app/components/MobileNavigation.tsx",
  "utf8",
);

assert.match(
  sessionSource,
  /export const ACCOUNT_SESSION_CHANGE_EVENT/,
  "Buyer account session changes must be observable by the account boundary.",
);
assert.match(
  sessionSource,
  /sessionIsExpired\(expiresAtMs\)[\s\S]*clearAccountSession\(\)/,
  "Expired sessions without a usable refresh path must be cleared instead of reused.",
);
assert.match(
  sessionSource,
  /client\.auth\.refreshSession\([\s\S]*refresh_token/,
  "Buyer sessions must refresh through Supabase before protected account requests.",
);
assert.match(
  sessionSource,
  /export async function fetchWithAccountSession/,
  "Protected buyer requests must use the central authenticated fetch helper.",
);
assert.match(
  sessionSource,
  /if \(response\.status !== 401\) return response;[\s\S]*getFreshAccountSession\(0, true\)[\s\S]*response = await fetch/,
  "A protected buyer request must force-refresh and retry exactly after a 401.",
);
assert.match(
  sessionSource,
  /if \(response\.status === 401\) \{[\s\S]*clearAccountSession\(\)/,
  "A session that remains unauthorized after refresh must be cleared instead of leaving a fake logged-in UI.",
);
assert.match(
  boundarySource,
  /await getFreshAccountSession\(REFRESH_AHEAD_SECONDS, forceRefresh\)/,
  "The account boundary must refresh the stored session before rendering account pages.",
);
assert.match(
  boundarySource,
  /if \(!ready\)[\s\S]*Checking your account/,
  "Account children must remain blocked until the initial refresh decision completes.",
);
assert.match(
  boundarySource,
  /setTimeout\([\s\S]*refreshSession\(true\)/,
  "Long-lived account pages must refresh again before the access token expires.",
);
assert.match(
  boundarySource,
  /window\.addEventListener\("focus", handleWindowFocus\)/,
  "Buyer sessions must refresh when a suspended mobile browser returns to the foreground.",
);
assert.match(
  boundarySource,
  /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/,
  "Buyer sessions must refresh when the account tab becomes visible again.",
);
assert.match(
  boundarySource,
  /key=\{version\}/,
  "Account children must remount after token rotation so stale bearer tokens are not retained in component state.",
);
assert.match(
  layoutSource,
  /<AccountSessionBoundary>[\s\S]*\{children\}[\s\S]*<\/AccountSessionBoundary>/,
  "Every /account route and any account-only controls must remain inside the session refresh boundary.",
);
assert.match(
  ordersSource,
  /fetchWithAccountSession\("\/api\/account\/orders"/,
  "The buyer orders screen must use the refresh-and-retry account request path.",
);
assert.doesNotMatch(
  ordersSource,
  /Authorization: `Bearer \$\{session\.access_token\}`/,
  "The buyer orders screen must not send a frozen localStorage token directly.",
);
assert.match(
  navbarSource,
  /<MobileNavigation links=\{navigationLinks\} \/>/,
  "The mobile header must use the route-aware navigation component.",
);
assert.match(
  mobileNavigationSource,
  /const pathname = usePathname\(\)/,
  "Mobile navigation must observe route changes.",
);
assert.match(
  mobileNavigationSource,
  /element\.scrollLeft = 0;[\s\S]*\[pathname\]/,
  "Mobile navigation must reset its horizontal position after navigation so the first link is not clipped.",
);

console.log(
  "Buyer account and mobile navigation contracts passed: protected account pages refresh before render, retry once after a 401, clear dead sessions, refresh after mobile resume, remount after token rotation, and reset the mobile navigation position after route changes.",
);
