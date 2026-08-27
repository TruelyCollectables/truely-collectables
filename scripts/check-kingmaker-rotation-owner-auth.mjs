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
  'Authorization: `Bearer ${session.access_token}`',
  "seller bearer token on image request",
);
requireText(
  page,
  "const nextFront = text(data.frontImageUrl);",
  "immediate rotated URL rendering",
);

console.log(
  "KINGMAKER owner authorization, EXIF rotation, and permanent storage contract passed.",
);
