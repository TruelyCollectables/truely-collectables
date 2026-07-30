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
  /key=\{version\}/,
  "Account children must remount after token rotation so stale bearer tokens are not retained in component state.",
);
assert.match(
  layoutSource,
  /<AccountSessionBoundary>\{children\}<\/AccountSessionBoundary>/,
  "Every /account route must pass through the session refresh boundary.",
);
assert.match(
  ordersSource,
  /Authorization: `Bearer \$\{session\.access_token\}`/,
  "Orders must continue using the refreshed bearer token supplied through the account session.",
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
  "Buyer account and mobile navigation contracts passed: expired tokens clear, refresh happens before render, long-lived routes rotate, account children remount on token change, and mobile navigation returns to the first link after route changes.",
);
