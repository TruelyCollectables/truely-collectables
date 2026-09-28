import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveInstaCompChecklistFirstFromRegistry } from "../src/lib/instacomp-checklist-first-server";

process.env.INSTACOMP_AI_LOCAL_URL = "https://mac.truelycollectables.com";
process.env.INSTACOMP_AI_LOCAL_KEY = "test-key";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({
      ok: true,
      status: "exact_match",
      match: {
        identityId: "registry-id-1",
        fingerprintSha256: "f".repeat(64),
        year: "2025",
        manufacturer: "Panini",
        brand: "Donruss",
        product: "Donruss WNBA",
        setName: "Base",
        cardNumber: "66",
        player: "Elizabeth Kitley",
        serialRun: 25,
        isAuto: false,
        isRelic: false,
        parallel: "Pink Shimmer",
        team: "Las Vegas Aces",
      },
      candidates: [],
      reasons: ["one_internal_checklist_identity_matches_all_available_visible_evidence"],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
async function main() {
  try {
    const decision = await resolveInstaCompChecklistFirstFromRegistry({
      year: "2025",
      manufacturer: "Panini",
      brand: "Donruss",
      setName: "Donruss WNBA",
      subset: "Base",
      cardNumber: "66",
      player: "Elizabeth Kitley",
      serialNumber: "23/25",
      isAuto: false,
      isRelic: false,
      parallel: "Pink Shimmer",
    });

    assert.equal(decision.status, "exact_match");
    assert.equal(decision.match?.identityId, "registry-id-1");
    assert.equal(decision.match?.fingerprintSha256, "f".repeat(64));
    assert.equal(decision.match?.parallel, "Pink Shimmer");
    assert.equal(decision.match?.serialRun, 25);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const pendingRoute = readFileSync(
    "src/app/api/account/seller/instacomp-pending-identity/route.ts",
    "utf8",
  );
  const verifiedRoute = readFileSync(
    "src/app/api/account/seller/inventory/instacomp-verified/route.ts",
    "utf8",
  );
  assert.match(pendingRoute, /getMacKingmakerInventoryItem/);
  assert.match(pendingRoute, /runExactMacIdentity/);
  assert.match(pendingRoute, /registryFingerprintSha256/);
  assert.match(pendingRoute, /source: "checklist_registry"/);
  assert.match(pendingRoute, /sourceOfTruth: "mac_local"/);
  assert.match(pendingRoute, /CHECKLIST_IDENTITY_REQUIRED/);
  assert.doesNotMatch(
    pendingRoute.slice(pendingRoute.indexOf("export async function POST")),
    /createSupabaseServerClient|\.from\(["']inventory_items["']\)|visualIdentity\(metadata\)/,
  );

  assert.match(verifiedRoute, /checklistIdentityLocked/);
  assert.match(verifiedRoute, /identity\?\.registryIdentityId/);
  assert.match(verifiedRoute, /identity\?\.registryFingerprintSha256/);
  assert.match(verifiedRoute, /CHECKLIST_IDENTITY_REQUIRED/);

  console.log("InstaComp pending Registry gate regressions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
