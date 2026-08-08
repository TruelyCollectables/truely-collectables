import assert from "node:assert/strict";
import { instaCompAiLocalScanToAi, type InstaCompAiLocalScan } from "../../src/lib/instacomp-ai-local";
import { revalidateChecklistRegistryReceipt, resolveChecklistRegistry } from "../../src/lib/instacomp-learning-server";

const mode = process.argv[2] || "pure";

function trustedMalongaScan(serialHint: string | null): InstaCompAiLocalScan {
  return {
    schema_version: "tcos.instacomp-ai.scan.v1",
    scan_id: "cert-malonga-116",
    status: "trusted_memory_match",
    pricing_allowed: false,
    learning_allowed: false,
    trusted_identity: {
      player: "Dominique Malonga",
      year: "2025",
      manufacturer: "Panini",
      set_name: "Base",
      card_number: "116",
      parallel: "Prizms Ice",
      serial_run: 299,
      team: "Seattle Storm",
      sport: "Basketball",
      rookie: true,
      autograph: false,
      memorabilia: false,
    },
    local_vision: {
      identity_hints: {
        year: "2025",
        manufacturer: "Panini",
        card_number: "116",
        parallel: "Prizms Ice",
        ...(serialHint ? { serial_number: serialHint } : {}),
      },
      front: { ocr: [] },
      back: { ocr: [] },
    },
    match_source: "exact_image_pair",
    visual_match_score: 1,
    checklist: {
      outcome: "exact_match",
      identity_id: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
      source_receipts: [
        "registry_fingerprint:112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
      ],
      reasons: ["checklist_exact_match"],
    },
    next_action: "none",
  } as InstaCompAiLocalScan;
}

async function pure() {
  const staleMemoryOnly = instaCompAiLocalScanToAi(trustedMalongaScan(null));
  assert.ok(staleMemoryOnly);
  assert.equal(staleMemoryOnly.serialNumber, null, "stale trusted-memory serial_run must not become visible serial evidence");

  const currentlyVisible = instaCompAiLocalScanToAi(trustedMalongaScan("17/299"));
  assert.ok(currentlyVisible);
  assert.equal(currentlyVisible.serialNumber, "/299", "current deterministic serial evidence must preserve its print run");
  console.log("PASS pure: stale serial memory is cleared unless current deterministic scan re-proves /run");
}

async function live() {
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL required");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY required");

  const malonga = await revalidateChecklistRegistryReceipt({
    ai: {
      player: "Dominique Malonga",
      year: "2025",
      brand: "Panini",
      setName: "Base",
      cardNumber: "116",
      parallel: "Prizms Ice",
      serialNumber: null,
      team: "Seattle Storm",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
    },
    identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    fingerprintSha256: "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
  });
  assert.equal(malonga?.status, "internal_exact_match", `Malonga receipt: ${malonga?.status || "null"}`);
  assert.equal(malonga?.match?.identityId, "bde0577b-72e8-4e59-8287-89aaf2f9e7e2");
  assert.equal(malonga?.match?.fingerprintSha256, "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32");

  const staleSerialMustNotValidate = await revalidateChecklistRegistryReceipt({
    ai: {
      player: "Dominique Malonga",
      year: "2025",
      brand: "Panini",
      setName: "Base",
      cardNumber: "116",
      parallel: "Prizms Ice",
      serialNumber: "/299",
      team: "Seattle Storm",
      sport: "Basketball",
      league: "WNBA",
      isAuto: false,
      isRelic: false,
    },
    identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    fingerprintSha256: "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
  });
  assert.equal(staleSerialMustNotValidate, null, "stale /299 must not validate the unnumbered Ice identity");

  const rickea = await resolveChecklistRegistry({
    player: "Rickea Jackson",
    year: "2025",
    brand: "Panini",
    setName: "PRIZM",
    cardNumber: "118",
    parallel: "Base",
    team: "Los Angeles Sparks",
    sport: "Basketball",
    league: "WNBA",
    isAuto: false,
    isRelic: false,
    registryVisibleText: "RICKea JACKSON 118 PANINI PRIZM WNBA",
  }, { evidenceTrusted: false });
  assert.equal(rickea.status, "internal_exact_match", `Rickea PRIZM product-line probe: ${rickea.status} ${rickea.reasons.join(",")}`);
  assert.equal(rickea.candidateCount, 1);
  assert.equal(rickea.match?.identityId, "70ad307e-06bb-45c2-90ea-689b6e2f302e");
  assert.equal(rickea.match?.fingerprintSha256, "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028");
  assert.equal(rickea.match?.setName, "Base");

  const groovy = await resolveChecklistRegistry({
    player: "Sonia Citron",
    year: "2025",
    brand: "Panini",
    setName: "PRIZM",
    cardNumber: "13",
    parallel: "Base",
    sport: "Basketball",
    league: "WNBA",
    isAuto: false,
    isRelic: false,
    registryVisibleText: "GROOVY SONIA CITRON PRIZM WNBA",
  }, { evidenceTrusted: false });
  assert.equal(groovy.status, "internal_exact_match", `Groovy soft logical-set narrowing regression: ${groovy.status}`);
  assert.equal(groovy.match?.identityId, "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044");
  assert.equal(groovy.match?.setName, "Groovy");

  console.log("PASS live: Malonga exact Ice receipt + Rickea unique Base from PRIZM product line + Groovy narrowing preserved");
}

if (mode === "pure") await pure();
else if (mode === "live") await live();
else throw new Error(`Unknown mode ${mode}`);
