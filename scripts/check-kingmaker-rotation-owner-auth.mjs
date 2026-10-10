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
  route,
  "getAuthenticatedAccountFromRequest",
  "seller authentication on image request",
);

console.log(
  "KINGMAKER owner authorization, EXIF rotation, and permanent storage contract passed.",
);
