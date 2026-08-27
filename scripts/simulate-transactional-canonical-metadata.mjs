import assert from "node:assert/strict";
import fs from "node:fs";

const cartPage = fs.readFileSync("src/app/cart/page.tsx", "utf8");
const signupLayout = fs.readFileSync(
  "src/app/account/signup/layout.tsx",
  "utf8",
);

assert.match(
  cartPage,
  /alternates:\s*\{\s*canonical:\s*["']\/cart["']/s,
  "The cart must declare its own canonical URL instead of inheriting the homepage canonical.",
);
assert.match(
  cartPage,
  /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/s,
  "The cart must remain intentionally non-indexable.",
);
assert.match(
  signupLayout,
  /alternates:\s*\{\s*canonical:\s*["']\/account\/signup["']/s,
  "Buyer signup must declare its own canonical URL instead of inheriting the homepage canonical.",
);
assert.match(
  signupLayout,
  /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/s,
  "Buyer signup must remain intentionally non-indexable.",
);

console.log("Transactional canonical metadata simulation passed.");
