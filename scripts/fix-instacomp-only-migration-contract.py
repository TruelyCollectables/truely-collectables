from __future__ import annotations

from pathlib import Path


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
