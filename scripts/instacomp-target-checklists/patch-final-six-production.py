from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected source block not found")
    return text.replace(old, new, 1)


# Final six Hockey Production repair.
# This script intentionally runs AFTER patch-resumable-production-writer.py so
# it patches the runtime writer/parser shapes produced by the normal recovery
# hardening pass.

# ---------------------------------------------------------------------------
# 1) Registry staged writer: canonicalize the set sourceKey itself, not only
#    child references. The management RPC can normalize/dedupe set rows; using
#    deterministic keys derived from the normalized set identity means every
#    card/parallel chunk references the exact same canonical parent key.
# ---------------------------------------------------------------------------
writer = Path("scripts/instacomp-target-checklists/management-staged-registry-writer.mjs")
wtext = writer.read_text()

old = '''function canonicalizeSetAliases(plan) {
  const normalize = (value) => String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^\\p{L}\\p{N}/]+/gu, " ")
    .trim();
  const keptByIdentity = new Map();
  const alias = new Map();
  const sets = [];
  for (const set of plan.sets || []) {
    const identity = normalize(set.normalizedName || set.name || set.sourceKey);
    const prior = keptByIdentity.get(identity);
    if (!prior) {
      keptByIdentity.set(identity, set);
      alias.set(String(set.sourceKey), String(set.sourceKey));
      sets.push(set);
    } else {
      alias.set(String(set.sourceKey), String(prior.sourceKey));
    }
  }
  const cards = (plan.cards || []).map((card) => ({
    ...card,
    setSourceKey: alias.get(String(card.setSourceKey)) || card.setSourceKey,
  }));
  const parallels = (plan.parallels || []).map((parallel) => ({
    ...parallel,
    setSourceKey: alias.get(String(parallel.setSourceKey)) || parallel.setSourceKey,
  }));
  return {
    ...plan,
    sets,
    cards,
    parallels,
    validation: {
      ...plan.validation,
      counts: { ...plan.validation.counts, sets: sets.length },
    },
  };
}'''

new = '''function canonicalizeSetAliases(plan) {
  const normalize = (value) => String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^\\p{L}\\p{N}/]+/gu, " ")
    .trim();
  const keyFor = (identity) => `set-${String(identity || "base")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "base"}`;
  const keptByIdentity = new Map();
  const alias = new Map();
  const sets = [];
  for (const set of plan.sets || []) {
    const identity = normalize(set.normalizedName || set.name || set.sourceKey);
    const canonicalKey = keyFor(identity);
    alias.set(String(set.sourceKey), canonicalKey);
    if (!keptByIdentity.has(identity)) {
      const kept = { ...set, sourceKey: canonicalKey };
      keptByIdentity.set(identity, kept);
      sets.push(kept);
    }
  }
  const cards = (plan.cards || []).map((card) => ({
    ...card,
    setSourceKey: alias.get(String(card.setSourceKey)) || keyFor(card.setSourceKey),
  }));
  const parallels = (plan.parallels || []).map((parallel) => ({
    ...parallel,
    setSourceKey: alias.get(String(parallel.setSourceKey)) || keyFor(parallel.setSourceKey),
  }));
  return {
    ...plan,
    sets,
    cards,
    parallels,
    validation: {
      ...plan.validation,
      counts: { ...plan.validation.counts, sets: sets.length },
    },
  };
}'''

wtext = replace_once(wtext, old, new, "Registry canonical set-source-key repair")
writer.write_text(wtext)


# ---------------------------------------------------------------------------
# 2) Chicago Blackhawks Centennial: the official H1 omits both Hockey and the
#    season. Existing recovery injects season; ensure Hockey is also present so
#    the parser produces sport=Hockey instead of Other while preserving the
#    original archived source unchanged.
# ---------------------------------------------------------------------------
chicago = Path("src/lib/checklist-registry/upper-deck-2025-26-chicago-html.ts")
ctext = chicago.read_text()

old_chicago = '''    const withSeason = original.replace(/<h1\\b([^>]*)>([\\s\\S]*?)<\\/h1>/i, (full, attrs: string, inner: string) =>
      /\\b20\\d{2}\\s*-\\s*\\d{2,4}\\b/.test(text(inner)) ? full : `<h1${attrs}>2025-26 ${inner}</h1>`
    );'''

new_chicago = '''    const withSeason = original.replace(
      /<h1\\b([^>]*)>([\\s\\S]*?)<\\/h1>/i,
      (full, attrs: string, inner: string) => {
        const rawTitle = text(inner);
        const withPeriod = /\\b20\\d{2}\\s*-\\s*\\d{2,4}\\b/.test(rawTitle)
          ? rawTitle
          : `2025-26 ${rawTitle}`;
        const hockeyTitle = /\\bhockey\\b/i.test(withPeriod)
          ? withPeriod
          : `${withPeriod} Hockey`;
        return `<h1${attrs}>${hockeyTitle}</h1>`;
      },
    );'''

ctext = replace_once(ctext, old_chicago, new_chicago, "Chicago Hockey classification repair")
chicago.write_text(ctext)

print("Patched final six Hockey Production mapping/classification blockers")
