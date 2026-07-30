import assert from "node:assert/strict";
import fs from "node:fs";

const navbar = fs.readFileSync("src/app/components/Navbar.tsx", "utf8");

assert.match(navbar, /href: "\/shop\?feature=rookie", label: "Rookies"/);
assert.match(navbar, /href: "\/shop\?feature=autograph", label: "Autos"/);
assert.match(navbar, /href: "\/shop\?feature=graded", label: "Graded"/);
assert.match(navbar, /<MobileNavigation links=\{navigationLinks\} \/>/);

assert.doesNotMatch(navbar, /\/shop\?q=rookie/);
assert.doesNotMatch(navbar, /\/shop\?q=autograph/);
assert.doesNotMatch(navbar, /\/shop\?q=PSA/i);

console.log(
  JSON.stringify(
    {
      ok: true,
      realFeatureFilters: ["rookie", "autograph", "graded"],
      desktopAndMobileShareFixedLinks: true,
    },
    null,
    2,
  ),
);
