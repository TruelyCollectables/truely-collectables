from __future__ import annotations

from pathlib import Path


storage_path = Path("services/instacomp-ai/app/storage.py")
storage = storage_path.read_text()
premature_index = (
    "                CREATE INDEX IF NOT EXISTS scans_front_phash_idx "
    "ON scans(front_perceptual_hash);\n"
)

if premature_index in storage:
    storage = storage.replace(premature_index, "", 1)
    storage_path.write_text(storage)
    print("Premature perceptual-hash index removed")
else:
    print("Premature perceptual-hash index already absent")

# Validate the real migration order directly. Newer contracts no longer need a
# duplicated static block in check-instacomp-local-primary-contract.mjs.
storage = storage_path.read_text()
scan_column_migration = storage.find(
    'db.execute(f"ALTER TABLE scans ADD COLUMN {column} TEXT")'
)
phash_index_creation = storage.find(
    '"CREATE INDEX IF NOT EXISTS scans_front_phash_idx "'
)
if (
    scan_column_migration < 0
    or phash_index_creation < 0
    or phash_index_creation <= scan_column_migration
):
    raise SystemExit(
        "Legacy scan columns must be added before the perceptual-hash index is created"
    )
print("Exact migration order verified directly")

# Preserve compatibility with an older contract only when that block still
# exists. Its absence on the current checklist-only contract is not a failure.
path = Path("scripts/check-instacomp-local-primary-contract.mjs")
text = path.read_text()
old = '''const phashIndexInCreateScript = storage.indexOf(
  "CREATE INDEX IF NOT EXISTS scans_front_phash_idx ON scans(front_perceptual_hash);",
);
const scanColumnMigration = storage.indexOf('db.execute(f"ALTER TABLE scans ADD COLUMN {column} TEXT")');
if (phashIndexInCreateScript >= 0 && phashIndexInCreateScript < scanColumnMigration) {
  throw new Error("Legacy scan columns must be added before the perceptual-hash index is created.");
}
'''
new = '''const scanColumnMigration = storage.indexOf(
  'db.execute(f"ALTER TABLE scans ADD COLUMN {column} TEXT")',
);
const phashIndexCreation = storage.indexOf(
  '"CREATE INDEX IF NOT EXISTS scans_front_phash_idx "',
);
if (
  scanColumnMigration < 0 ||
  phashIndexCreation < 0 ||
  phashIndexCreation <= scanColumnMigration
) {
  throw new Error(
    "Legacy scan columns must be added before the perceptual-hash index is created.",
  );
}
'''
if new in text:
    print("Exact migration-order contract already applied")
elif old in text:
    path.write_text(text.replace(old, new, 1))
    print("Exact migration-order contract upgraded")
else:
    print("Static migration-order block retired; direct verification is authoritative")

route_path = Path("src/app/api/instacomp/scan/route.ts")
route = route_path.read_text()
target_serial = "    const serialOcr = null as InstaCompSerialOcrResult | null;\n"
if target_serial in route:
    print("Disabled serial reader already uses the exact result type")
else:
    for prior in [
        "    const serialOcr = null;\n",
        "    const serialOcr: ExternalOcrResult | null = null;\n",
        "    const serialOcr = null as ExternalOcrResult | null;\n",
    ]:
        if prior in route:
            route = route.replace(prior, target_serial, 1)
            route_path.write_text(route)
            print("Disabled serial reader now uses the exact result type")
            break
    else:
        raise SystemExit("Disabled serial reader declaration anchor missing")

for gate_path in [
    Path("scripts/check-instacomp-provider-fallback.mjs"),
    Path("scripts/check-instacomp-local-primary-contract.mjs"),
]:
    gate = gate_path.read_text()
    expected = "const serialOcr = null as InstaCompSerialOcrResult | null;"
    if expected in gate:
        continue
    for prior in [
        "const serialOcr = null;",
        "const serialOcr: ExternalOcrResult | null = null;",
        "const serialOcr = null as ExternalOcrResult | null;",
    ]:
        if prior in gate:
            gate_path.write_text(gate.replace(prior, expected))
            break
    else:
        # The newest local-primary contract can enforce no external readers
        # without repeating this exact source literal. The provider gate still
        # carries the concrete serial-null assertion.
        if gate_path.name == "check-instacomp-local-primary-contract.mjs":
            print("Local-primary contract uses the newer no-external-reader assertion")
            continue
        raise SystemExit(f"Exact serial-reader gate anchor missing: {gate_path}")

print("Exact migration and disabled-serial-reader certification passed")
