from __future__ import annotations

from pathlib import Path


storage_path = Path("services/instacomp-ai/app/storage.py")
storage = storage_path.read_text()
premature_index = (
    "                CREATE INDEX IF NOT EXISTS scans_front_phash_idx "
    "ON scans(front_perceptual_hash);\n"
)

if premature_index in storage:
    storage_path.write_text(storage.replace(premature_index, "", 1))
    print("Premature perceptual-hash index removed")
else:
    print("Premature perceptual-hash index already absent")


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
    print("Exact migration-order contract applied")
else:
    raise SystemExit("Migration contract anchor missing")


route_path = Path("src/app/api/instacomp/scan/route.ts")
route = route_path.read_text()
untyped_serial = "    const serialOcr = null;\n"
typed_serial = "    const serialOcr: ExternalOcrResult | null = null;\n"

if typed_serial in route:
    print("Disabled serial reader is already explicitly typed")
elif untyped_serial in route:
    route_path.write_text(route.replace(untyped_serial, typed_serial, 1))
    print("Disabled serial reader explicitly typed")
else:
    raise SystemExit("Disabled serial reader declaration anchor missing")


for gate_path in [
    Path("scripts/check-instacomp-provider-fallback.mjs"),
    Path("scripts/check-instacomp-local-primary-contract.mjs"),
]:
    gate = gate_path.read_text()
    if "const serialOcr: ExternalOcrResult | null = null;" in gate:
        continue
    if "const serialOcr = null;" not in gate:
        raise SystemExit(f"Typed serial-reader gate anchor missing: {gate_path}")
    gate_path.write_text(
        gate.replace(
            "const serialOcr = null;",
            "const serialOcr: ExternalOcrResult | null = null;",
        )
    )

print("Typed disabled-serial-reader gates applied")
