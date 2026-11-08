import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, value, label) {
  if (!source.includes(value)) {
    throw new Error(`Missing ${label}: ${value}`);
  }
}

const route = read("src/app/api/account/seller/inventory/instacomp-image-rotate/route.ts");
const page = read("src/app/kingmaker/pending/PendingClient.tsx");
const localAuth = read("src/lib/kingmaker-local-auth.ts");
const localSession = read("src/app/kingmaker/kingmaker-session.ts");

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
requireText(
  page,
  "rotateClockwise90",
  "browser pixel rotation before upload",
);
requireText(
  page,
  'form.set("frontImage", frontImage)',
  "rotated front image submission",
);
requireText(
  page,
  'form.set("backImage", backImage)',
  "rotated back image submission",
);
requireText(
  page,
  'Authorization: `Bearer ${session.access_token}`',
  "KINGMAKER local session bearer propagation",
);
requireText(
  localSession,
  'KINGMAKER_LOCAL_BEARER = "kingmaker-local-admin-cookie"',
  "local KINGMAKER session marker",
);
requireText(
  localAuth,
  "hasValidAdminRequest",
  "HttpOnly admin-cookie authorization",
);
requireText(
  route,
  "archiveInstaCompAiLocalSupervisedScan",
  "Mac-local permanent image archive",
);
requireText(
  route,
  "updateMacKingmakerDraft",
  "Mac-local master listing persistence",
);
requireText(
  route,
  "imagePersistenceVerified: true",
  "permanent image persistence receipt",
);
requireText(
  page,
  "await load(queue || queueFromLocation());",
  "post-rotation pending reload",
);

console.log(
  "KINGMAKER owner authorization, EXIF rotation, and permanent storage contract passed.",
);
