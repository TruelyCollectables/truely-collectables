from pathlib import Path


path = Path("src/lib/instacomp-identity-guard.ts")
text = path.read_text()
corrupted = '''      ...surfaceGuardedAi,
      parallel: corrected,
      notes: appendNote(
        surfaceGuardedAi.notes,
        `Prizm surface firewall corrected'''
repaired = '''      ...ai,
      parallel: corrected,
      notes: appendNote(
        ai.notes,
        `Prizm surface firewall corrected'''

count = text.count(corrupted)
if count not in {0, 2}:
    raise SystemExit(
        f"Prizm firewall scope repair expected 0 or 2 helper replacements, found {count}"
    )
if count:
    text = text.replace(corrupted, repaired)
    path.write_text(text)

print("Prizm firewall helper scope verified")
