from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: expected source block not found')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) Harden/resume the management SQL writer and canonicalize duplicate set
#    source keys before staged writes. Several valid plans contain two source
#    set keys that normalize to the same Registry set; the DB correctly keeps
#    one physical set row, so child chunks must be remapped to that canonical
#    key before they are sent.
# ---------------------------------------------------------------------------
writer = Path('scripts/instacomp-target-checklists/management-staged-registry-writer.mjs')
text = writer.read_text()

text = text.replace(
    '${jsonSql(plan, "plan")}',
    '${jsonSql({ schema: plan.schema, adapterId: plan.adapterId, adapterVersion: plan.adapterVersion, source: plan.source, release: plan.release, validation: { status: plan.validation.status, counts: plan.validation.counts } }, "plan")}',
    1,
)
text = text.replace('|aborted|temporar/i.test', '|aborted|temporar|lock timeout|55P03/i.test')
text = text.replace(
    'await sleep(Math.min(30_000, 2_000 * attempt));',
    'await sleep(Math.min(90_000, 15_000 * (2 ** (attempt - 1))));',
)

canonicalizer = '''
function canonicalizeSetAliases(plan) {
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
}
'''

if 'function canonicalizeSetAliases(plan)' not in text:
    marker = 'export async function persistPlanManagement(plan, bytes) {'
    if marker not in text:
        raise SystemExit('Writer persistence entrypoint not found')
    text = text.replace(marker, canonicalizer + '\n' + marker, 1)

entry = 'export async function persistPlanManagement(plan, bytes) {\n  if (plan?.validation?.status !== "passed") {'
replacement = 'export async function persistPlanManagement(plan, bytes) {\n  plan = canonicalizeSetAliases(plan);\n  if (plan?.validation?.status !== "passed") {'
if replacement not in text:
    text = replace_once(text, entry, replacement, 'Writer canonicalization entry')

old = '''  const cardChunks = chunks(plan.cards, CARD_CHUNK);
  for (let i = 0; i < cardChunks.length; i += 1) await appendChunk(versionId, { cards: cardChunks[i] }, `Registry cards ${i + 1}/${cardChunks.length} via management SQL`);
  const parallelChunks = chunks(plan.parallels, PARALLEL_CHUNK);
  for (let i = 0; i < parallelChunks.length; i += 1) await appendChunk(versionId, { parallels: parallelChunks[i] }, `Registry parallels ${i + 1}/${parallelChunks.length} via management SQL`);
  const identityChunks = chunks(plan.identities, IDENTITY_CHUNK);
  for (let i = 0; i < identityChunks.length; i += 1) await appendChunk(versionId, { identities: identityChunks[i] }, `Registry identities ${i + 1}/${identityChunks.length} via management SQL`);'''

new = '''  const setByKey = new Map((plan.sets || []).map((row) => [String(row.sourceKey), row]));
  const cardByKey = new Map((plan.cards || []).map((row) => [String(row.sourceKey), row]));
  const parallelByKey = new Map((plan.parallels || []).map((row) => [String(row.sourceKey), row]));
  const unique = (rows) => [...new Map(rows.filter(Boolean).map((row) => [String(row.sourceKey), row])).values()];

  const cardChunks = chunks(plan.cards, CARD_CHUNK);
  for (let i = 0; i < cardChunks.length; i += 1) {
    const parents = unique(cardChunks[i].map((card) => setByKey.get(String(card.setSourceKey))));
    await appendChunk(versionId, { sets: parents, cards: cardChunks[i] }, `Registry cards ${i + 1}/${cardChunks.length} via management SQL`);
  }
  const parallelChunks = chunks(plan.parallels, PARALLEL_CHUNK);
  for (let i = 0; i < parallelChunks.length; i += 1) {
    const parents = unique(parallelChunks[i].map((parallel) => setByKey.get(String(parallel.setSourceKey))));
    await appendChunk(versionId, { sets: parents, parallels: parallelChunks[i] }, `Registry parallels ${i + 1}/${parallelChunks.length} via management SQL`);
  }
  const identityChunks = chunks(plan.identities, IDENTITY_CHUNK);
  for (let i = 0; i < identityChunks.length; i += 1) {
    const identityCards = unique(identityChunks[i].map((identity) => cardByKey.get(String(identity.cardSourceKey))));
    const identityParallels = unique(identityChunks[i].map((identity) => identity.parallelSourceKey ? parallelByKey.get(String(identity.parallelSourceKey)) : null));
    const identitySets = unique([
      ...identityCards.map((card) => setByKey.get(String(card.setSourceKey))),
      ...identityParallels.map((parallel) => setByKey.get(String(parallel.setSourceKey))),
    ]);
    await appendChunk(versionId, { sets: identitySets, cards: identityCards, parallels: identityParallels, identities: identityChunks[i] }, `Registry identities ${i + 1}/${identityChunks.length} via management SQL`);
  }'''

if old in text:
    text = text.replace(old, new, 1)
elif 'const setByKey = new Map((plan.sets || [])' not in text:
    raise SystemExit('Expected staged chunk loops not found')
writer.write_text(text)


# ---------------------------------------------------------------------------
# 2) Leaf: never build a fake text/plain source just to learn the release slug.
#    The slug is deterministic, so preflight it directly and then parse the
#    actual XLS/XLSX/CSV source with its real MIME type.
# ---------------------------------------------------------------------------
leaf = Path('scripts/instacomp-target-checklists/apply-official-leaf-hockey-management.mjs')
ltext = leaf.read_text()
leaf_pattern = re.compile(
    r'const entry=entryFor\(target\);\s*const expectedPlan=buildPlan\(entry,\{cards:\[\{setName:"Base Set",cardNumber:"PREFLIGHT".*?row\.releaseSlug=expectedPlan\.release\.releaseSlug;\s*const before=await preflightReleaseManagement\(row\.releaseSlug\);',
    re.S,
)
leaf_replacement = '''const entry=entryFor(target);
      row.releaseSlug=`${target.season}-leaf-${target.product}-hockey`.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
      const before=await preflightReleaseManagement(row.releaseSlug);'''
ltext, count = leaf_pattern.subn(leaf_replacement, ltext, count=1)
if count != 1 and 'Preflight Placeholder' in ltext:
    raise SystemExit(f'Leaf fake preflight patch failed, replaced {count}')
leaf.write_text(ltext)


# ---------------------------------------------------------------------------
# 3) 2021-22 O-Pee-Chee: the official workbook intentionally uses the same
#    JOKER number for multiple Joker subjects. Merge those deterministic Joker
#    subjects exactly like an explicit multi-subject card rather than rejecting
#    the entire 5k-card release.
# ---------------------------------------------------------------------------
workbook = Path('scripts/instacomp-target-checklists/recover-selected-workbooks.mjs')
wtext = workbook.read_text()
old_condition = 'if (explicitlyMultiSubjectSet(setName)) {'
new_condition = '''if (
        explicitlyMultiSubjectSet(setName) ||
        (
          entry?.release?.exactSetKey === "hockey|2021-22|upper-deck|o-pee-chee-nhl" &&
          /^playing cards - jokers$/i.test(setName) &&
          /^joker$/i.test(cardNumber)
        )
      ) {'''
if new_condition not in wtext:
    wtext = replace_once(wtext, old_condition, new_condition, 'O-Pee-Chee Joker merge')
workbook.write_text(wtext)


# ---------------------------------------------------------------------------
# 4) Generic Upper Deck HTML parser robustness for the remaining official
#    pages: Subjects or First/Last can be the subject column, SP/SSP in the
#    official serial column is a variation marker, and the 2025 Spring Expo is
#    an official Upper Deck page outside /checklist/.
# ---------------------------------------------------------------------------
ud = Path('src/lib/checklist-registry/upper-deck-html.ts')
udtext = ud.read_text()

udtext = udtext.replace(
    'description: findHeaderIndex(table.headers, ["Description", "Player Name"]),',
    'description: findHeaderIndex(table.headers, ["Description", "Player Name", "Decription"]),\n    firstName: findHeaderIndex(table.headers, ["First Name"]),\n    lastName: findHeaderIndex(table.headers, ["Last Name"]),',
    1,
)
udtext = udtext.replace(
    'if (indexes.setName < 0 || indexes.card < 0 || indexes.description < 0) {\n    throw new Error(\n      "Upper Deck checklist table requires Set Name, Card, and Description/Player Name columns",\n    );\n  }',
    'if (indexes.setName < 0 || indexes.card < 0 || (indexes.description < 0 && indexes.subjects < 0 && (indexes.firstName < 0 || indexes.lastName < 0))) {\n    throw new Error(\n      "Upper Deck checklist table requires Set Name, Card, and a Description/Player, Subjects, or First/Last Name column",\n    );\n  }',
    1,
)
udtext = udtext.replace(
    'description: at(cells, indexes.description),',
    'description: at(cells, indexes.description) || at(cells, indexes.subjects) || clean(`${at(cells, indexes.firstName)} ${at(cells, indexes.lastName)}`),',
    1,
)
udtext = udtext.replace(
    'if (clean(row.shortPrint)) values.push(clean(row.shortPrint));',
    'if (clean(row.shortPrint)) values.push(clean(row.shortPrint));\n  if (/^(?:SP|SSP)$/i.test(clean(row.serial))) values.push(clean(row.serial).toUpperCase());',
    1,
)
udtext = udtext.replace(
    'if (row.serial && serialRun == null) {',
    'if (row.serial && serialRun == null && !/^(?:SP|SSP)$/i.test(clean(row.serial))) {',
    1,
)
udtext = udtext.replace(
    '!/^https:\\/\\/(?:www\\.)?upperdeck\\.com\\/checklist\\//i.test(artifact.sourceUrl)',
    '!/^https:\\/\\/(?:www\\.)?upperdeck\\.com\\/(?:checklist\\/|2025-spring-sports-card-memorabilia-expo\\/?)/i.test(artifact.sourceUrl)',
    1,
)
ud.write_text(udtext)


# ---------------------------------------------------------------------------
# 5) Generic official adapter: accept the official Spring Expo path too.
# ---------------------------------------------------------------------------
official = Path('src/lib/checklist-registry/upper-deck-official-html.ts')
otext = official.read_text()
otext = otext.replace(
    '/^https:\\/\\/(?:www\\.)?upperdeck\\.com\\/checklist\\//i.test(artifact.sourceUrl)',
    '/^https:\\/\\/(?:www\\.)?upperdeck\\.com\\/(?:checklist\\/|2025-spring-sports-card-memorabilia-expo\\/?)/i.test(artifact.sourceUrl)',
    1,
)
official.write_text(otext)


# ---------------------------------------------------------------------------
# 6) 2025-26 normalized pages: AHL/PWHL are Hockey even when the H1 already
#    contains the league acronym. Ensure the normalized H1 says Hockey.
# ---------------------------------------------------------------------------
normalized = Path('src/lib/checklist-registry/upper-deck-2025-26-normalized-html.ts')
ntext = normalized.read_text()
ntext = ntext.replace(
    'if (!/\\b(hockey|ahl|pwhl)\\b/i.test(title)) title = `${title} Hockey`;',
    'if (!/\\bhockey\\b/i.test(title)) title = `${title} Hockey`;',
    1,
)
normalized.write_text(ntext)


# ---------------------------------------------------------------------------
# 7) Tim Hortons: use its typo-normalizing adapter for every official Tim
#    Hortons checklist season, not only the 2025-26 URL.
# ---------------------------------------------------------------------------
tim = Path('src/lib/checklist-registry/upper-deck-tim-hortons-official-html.ts')
ttext = tim.read_text()
ttext = ttext.replace(
    '/^https:\\/\\/(?:www\\.)?upperdeck\\.com\\/checklist\\/2025-2026-tim-hortons-checklist\\/?$/i.test(',
    '/^https:\\/\\/(?:www\\.)?upperdeck\\.com\\/checklist\\/.*tim-hortons.*checklist\\/?$/i.test(',
    1,
)
tim.write_text(ttext)


# ---------------------------------------------------------------------------
# 8) Chicago Centennial: the official H1 omits a season. Force the exact
#    known 2025-26 season into the parser view while archiving original HTML.
# ---------------------------------------------------------------------------
chicago = Path('src/lib/checklist-registry/upper-deck-2025-26-chicago-html.ts')
ctext = chicago.read_text()
old_chicago = '''    return upperDeck2025_26NormalizedHtmlChecklistAdapter.parse({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeChicagoChecklist(original),
    });'''
new_chicago = '''    const withSeason = original.replace(/<h1\\b([^>]*)>([\\s\\S]*?)<\\/h1>/i, (full, attrs: string, inner: string) =>
      /\\b20\\d{2}\\s*-\\s*\\d{2,4}\\b/.test(text(inner)) ? full : `<h1${attrs}>2025-26 ${inner}</h1>`
    );
    return upperDeck2025_26NormalizedHtmlChecklistAdapter.parse({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeChicagoChecklist(withSeason),
    });'''
if new_chicago not in ctext:
    ctext = replace_once(ctext, old_chicago, new_chicago, 'Chicago season normalization')
chicago.write_text(ctext)

print('Patched final Hockey Production unresolved import classes')
