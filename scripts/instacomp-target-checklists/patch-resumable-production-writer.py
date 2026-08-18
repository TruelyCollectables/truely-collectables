from pathlib import Path

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

if old not in text:
    raise SystemExit('Expected staged chunk loops not found')
writer.write_text(text.replace(old, new, 1))

# The current Leaf loader already computes its preflight release slug directly.
# Older recovery branches contained a dummy buildPlan() preflight that required a
# runtime rewrite; that obsolete shape is no longer present and must not make the
# Production recovery fail.
leaf = Path('scripts/instacomp-target-checklists/apply-official-leaf-hockey-management.mjs')
ltext = leaf.read_text()
if 'row.releaseSlug=' not in ltext or 'preflightReleaseManagement(row.releaseSlug)' not in ltext:
    raise SystemExit('Current Leaf preflight releaseSlug path was not found')

print('Patched resumable Production writer; current Leaf preflight is already compatible')
