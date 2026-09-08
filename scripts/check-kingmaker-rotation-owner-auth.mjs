import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, value, label) {
  if (!source.includes(value)) {
    throw new Error(`Missing ${label}: ${value}`);
  }
}

const route = read("src/app/api/admin/card-listing-images/route.ts");
const page = read("src/app/kingmaker/instacomp-audit/page.tsx");
const accountSession = read("src/app/account/account-session.ts");

requireText(
  route,
  'getAuthenticatedAccountFromRequest',
  "owner account authentication",
);
requireText(
  route,
  'email === "sales@truelycollectables.com"',
  "owner email authorization",
);
requireText(route, ".autoOrient()", "EXIF normalization before rotation");
requireText(
  route,
  'storedImageReadBack: true',
  "permanent image read-back receipt",
);
requireText(
  route,
  'storedFront !== front || storedBack !== back',
  "stored front/back equality gate",
);
requireText(
  page,
  'fetchWithAccountSession',
  "seller-authenticated fetch helper on image request",
);
requireText(
  accountSession,
  'headers.set("Authorization", `Bearer ${accessToken}`)',
  "seller bearer token propagation inside account fetch helper",
);
requireText(
  page,
  "await load();",
  "post-orientation workbench reload",
);
requireText(
  page,
  '["front", item.imageAudit.frontImageUrl]',
  "reloaded front image rendering",
);
requireText(
  page,
  '["back", item.imageAudit.backImageUrl]',
  "reloaded back image rendering",
);

console.log(
  "KINGMAKER owner authorization, EXIF rotation, and permanent storage contract passed.",
);
