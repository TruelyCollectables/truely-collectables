from pathlib import Path

p = Path('scripts/mainstream-checklist/source-tools.mjs')
text = p.read_text('utf-8')

# The parser's normalized() function canonicalizes Unicode dash variants to '-'.
# Keep the pre-existing nested-section self-test aligned with that canonical output.
text = text.replace('!names.has("Base Set — Series One")', '!names.has("Base Set - Series One")')
text = text.replace('!names.has("Autographs — Series One")', '!names.has("Autographs - Series One")')

if 'function explicitlyMultiSubjectSet(name)' not in text:
    anchor = 'function parseCardFromCells(cells) {'
    helper = r'''function explicitlyMultiSubjectSet(name) {
  const text = normalized(name).toLowerCase();
  if (!text) return false;
  const multi = /\b(?:dual|triple|quad|quartet|quint(?:uple)?|sextet|six[- ]?way|octet|eight[- ]?way|multi(?:ple)?|combo|combination|pairing|book|booklet|ensemble)\b/i.test(text);
  const hitType = /\b(?:autograph|signature|signed|relic|memorabilia|patch|swatch|jersey|book|booklet)\b/i.test(text);
  return multi && hitType;
}

function parseCardFromCells(cells) {'''
    if anchor not in text:
        raise SystemExit('parseCardFromCells anchor missing')
    text = text.replace(anchor, helper, 1)

old_status = '''      const setType = inferSetType(setName);
      cards.push({'''
if old_status in text:
    text = text.replace(old_status, '''      const setText = normalized(setName).toLowerCase();
      const hasAutograph = /autograph|signature|signed/.test(setText);
      const hasMemorabilia = /relic|memorabilia|patch|swatch|jersey/.test(setText);
      cards.push({''', 1)
old_fields = '''        autographStatus: setType === "autograph" ? "autograph" : "non-auto",
        memorabiliaStatus:
          setType === "memorabilia" ? "memorabilia" : "non-memorabilia",'''
if old_fields in text:
    text = text.replace(old_fields, '''        autographStatus: hasAutograph ? "autograph" : "non-auto",
        memorabiliaStatus: hasMemorabilia ? "memorabilia" : "non-memorabilia",''', 1)

old_dedupe = '''  const deduped = [];
  const exact = new Set();
  const byNumber = new Map();
  for (const card of cards) {
    const subject = card.players
      .map((value) => value.toLowerCase())
      .sort()
      .join("+");
    const numberKey = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const exactKey = `${numberKey}::${subject}`;
    if (exact.has(exactKey)) continue;
    exact.add(exactKey);
    const prior = byNumber.get(numberKey);
    if (prior && prior !== subject) {
      errors.push({
        code: "reference_card_number_subject_conflict",
        severity: "error",
        message: `${card.setName} #${card.cardNumber} maps to conflicting subjects.`,
      });
      continue;
    }
    byNumber.set(numberKey, subject);
    deduped.push(card);
  }'''
new_dedupe = '''  const deduped = [];
  const exact = new Set();
  const byNumber = new Map();
  for (const card of cards) {
    const subject = card.players
      .map((value) => value.toLowerCase())
      .sort()
      .join("+");
    const numberKey = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const exactKey = `${numberKey}::${subject}`;
    if (exact.has(exactKey)) continue;
    exact.add(exactKey);
    const prior = byNumber.get(numberKey);
    if (prior && prior.subject !== subject) {
      const sameVariation = normalized(prior.card.variation || "") === normalized(card.variation || "");
      if (sameVariation && explicitlyMultiSubjectSet(card.setName)) {
        prior.card.players = [...new Set([...prior.card.players, ...card.players])];
        prior.card.teams = [...new Set([...prior.card.teams, ...card.teams])];
        prior.card.rookieDesignation = prior.card.rookieDesignation || card.rookieDesignation;
        prior.card.firstBowmanDesignation = prior.card.firstBowmanDesignation || card.firstBowmanDesignation;
        if (card.autographStatus === "autograph") prior.card.autographStatus = "autograph";
        if (card.memorabiliaStatus === "memorabilia") prior.card.memorabiliaStatus = "memorabilia";
        prior.card.sourceNotes = normalized(`${prior.card.sourceNotes}; ${card.sourceNotes}; source-proven multi-subject card`);
        prior.subject = prior.card.players.map((value) => value.toLowerCase()).sort().join("+");
        continue;
      }
      errors.push({
        code: "reference_card_number_subject_conflict",
        severity: "error",
        message: `${card.setName} #${card.cardNumber} maps to conflicting subjects.`,
      });
      continue;
    }
    byNumber.set(numberKey, { subject, card });
    deduped.push(card);
  }'''
if old_dedupe in text:
    text = text.replace(old_dedupe, new_dedupe, 1)
elif 'prior.subject !== subject' not in text:
    raise SystemExit('dedupe anchor missing')

if 'multiSubjectCardsSupported: true' not in text:
    old_return = '''  return {
    status: "passed",
    cards: parsed.cards.length,
    parallels: parsed.parallels.length,
    metadataRowsIgnored: true,
    nestedSectionsPreserved: true,
  };'''
    new_return = '''  const multiAuto = parseChecklist({ minimumCardRows: 1 }, ["## Ultimate Autograph Book Card", "UAC-1 | Alpha Player | Team A", "UAC-1 | Beta Player | Team B", "UAC-1 | Gamma Player | Team C"].join("\\n"));
  if (multiAuto.errors.length || multiAuto.cards.length !== 1 || multiAuto.cards[0].players.length !== 3 || multiAuto.cards[0].autographStatus !== "autograph") throw new Error(`Multi-subject autograph parser self-test failed: ${JSON.stringify(multiAuto)}`);
  const multiMem = parseChecklist({ minimumCardRows: 1 }, ["## Dual Patch Memorabilia", "DPM-1 | Alpha Player | Team A", "DPM-1 | Beta Player | Team B"].join("\\n"));
  if (multiMem.errors.length || multiMem.cards.length !== 1 || multiMem.cards[0].players.length !== 2 || multiMem.cards[0].memorabiliaStatus !== "memorabilia") throw new Error(`Multi-subject memorabilia parser self-test failed: ${JSON.stringify(multiMem)}`);
  const autoRelic = parseChecklist({ minimumCardRows: 1 }, ["## Dual Autograph Patch Booklet", "DAPB-1 | Alpha Player | Team A", "DAPB-1 | Beta Player | Team B"].join("\\n"));
  if (autoRelic.errors.length || autoRelic.cards.length !== 1 || autoRelic.cards[0].autographStatus !== "autograph" || autoRelic.cards[0].memorabiliaStatus !== "memorabilia") throw new Error(`Multi-subject auto-memorabilia parser self-test failed: ${JSON.stringify(autoRelic)}`);
  const ordinaryConflict = parseChecklist({ minimumCardRows: 1 }, ["## Base Set", "1 | Alpha Player", "1 | Beta Player"].join("\\n"));
  if (!ordinaryConflict.errors.some((issue) => issue.code === "reference_card_number_subject_conflict")) throw new Error(`Ordinary conflict guard was weakened: ${JSON.stringify(ordinaryConflict)}`);

  return {
    status: "passed",
    cards: parsed.cards.length,
    parallels: parsed.parallels.length,
    metadataRowsIgnored: true,
    nestedSectionsPreserved: true,
    multiSubjectCardsSupported: true,
  };'''
    if old_return not in text:
        raise SystemExit('self-test return anchor missing')
    text = text.replace(old_return, new_return, 1)

p.write_text(text, 'utf-8')
