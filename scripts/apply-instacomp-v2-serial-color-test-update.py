from pathlib import Path

path = Path("scripts/run-instacomp-v2-hardening-simulations.ts")
text = path.read_text()

old = '''test("Registry serial run overrides a visual parallel guess but stays fail closed", () => {
  const row = {
    card_number: "149",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: { name: "Base Set" },
    release: {
      product_name: "Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Panini" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Kiki Iriafen" } }],
    teams: [{ team: { canonical_name: "Washington Mystics" } }],
    identities: [{
      id: "serial-identity-one",
      fingerprint_sha256: "e".repeat(64),
      canonical_key: "configuration=∅|language_code=∅",
      variation: null,
      autograph_status: "non-auto",
      memorabilia_status: "non-memorabilia",
      configuration_exclusivity: null,
      metadata: {},
      parallel: { name: "Blue Prizm", serial_run: 199 },
    }],
  };
  const serialAi = {
    ...ai,
    parallel: "Green Prizm",
    serialNumber: "12/199",
    league: "WNBA",
  };
  assert(
    chooseRegistryMatch(serialAi, [row]),
    "visible /199 should identify the unique /199 Registry identity",
  );

  const ambiguous = JSON.parse(JSON.stringify(row));
  ambiguous.identities.push({
    ...ambiguous.identities[0],
    id: "serial-identity-two",
    fingerprint_sha256: "f".repeat(64),
    parallel: { name: "Purple Prizm", serial_run: 199 },
  });
  equal(
    chooseRegistryMatch(serialAi, [ambiguous]),
    null,
    "multiple /199 identities must remain ambiguous",
  );
});
'''

new = '''test("Registry serial run and visible parallel must agree", () => {
  const row = {
    card_number: "149",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: { name: "Base Set" },
    release: {
      product_name: "Prizm WNBA",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Panini" },
      sport: { name: "Basketball" },
      league: { name: "WNBA" },
    },
    players: [{ player: { canonical_name: "Kiki Iriafen" } }],
    teams: [{ team: { canonical_name: "Washington Mystics" } }],
    identities: [{
      id: "serial-identity-one",
      fingerprint_sha256: "e".repeat(64),
      canonical_key: "configuration=∅|language_code=∅",
      variation: null,
      autograph_status: "non-auto",
      memorabilia_status: "non-memorabilia",
      configuration_exclusivity: null,
      metadata: {},
      parallel: { name: "Blue Prizm", serial_run: 199 },
    }],
  };
  const blueSerialAi = {
    ...ai,
    parallel: "Blue Prizm",
    serialNumber: "12/199",
    league: "WNBA",
  };
  assert(
    chooseRegistryMatch(blueSerialAi, [row]),
    "matching Blue and /199 evidence should identify the Blue /199 identity",
  );

  equal(
    chooseRegistryMatch(
      { ...blueSerialAi, parallel: "Green Prizm" },
      [row],
    ),
    null,
    "Green visual evidence must not resolve to a Blue /199 identity",
  );

  const ambiguous = JSON.parse(JSON.stringify(row));
  ambiguous.identities.push({
    ...ambiguous.identities[0],
    id: "serial-identity-two",
    fingerprint_sha256: "f".repeat(64),
  });
  equal(
    chooseRegistryMatch(blueSerialAi, [ambiguous]),
    null,
    "duplicate Blue /199 identities must remain ambiguous",
  );
});
'''

if text.count(old) != 1:
    raise SystemExit(f"Expected one stale serial override test; found {text.count(old)}")

path.write_text(text.replace(old, new, 1))
print("Updated adversarial serial/color expectations.")
