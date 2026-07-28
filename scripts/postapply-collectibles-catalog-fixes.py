from pathlib import Path

scope = Path("src/lib/sports-card-launch-scope.ts")
text = scope.read_text()
old = '''export type CollectibleLaunchCandidate = Pick<
  UniversalInventoryItem,
  "title" | "sport" | "category" | "storefrontSection" | "features"
>;
'''
new = '''export type CollectibleLaunchCandidate = Pick<
  UniversalInventoryItem,
  "title" | "sport"
> &
  Partial<
    Pick<UniversalInventoryItem, "category" | "storefrontSection" | "features">
  >;
'''
if old not in text and new not in text:
    raise SystemExit("Could not locate collectible launch candidate type")
scope.write_text(text.replace(old, new, 1))

engine = Path("src/lib/server-inventory-engine.ts")
engine_text = engine.read_text().replace("isLaunchSportsCard", "isLaunchCollectible")
engine.write_text(engine_text)
print("Applied post-patch compatibility fixes")
