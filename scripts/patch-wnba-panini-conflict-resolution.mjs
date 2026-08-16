import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), "scripts/import-wnba-panini-pdfs.mjs");
const source = readFileSync(path, "utf8");
const before = `  const deduped = [];
  const byIdentity = new Map();
  for (const card of parsedCards) {
    const key = \`${'${card.setName.toLowerCase()}'}::${'${card.cardNumber.toLowerCase()}'}\`;
    const prior = byIdentity.get(key);
    if (!prior) {
      byIdentity.set(key, card);
      deduped.push(card);
      continue;
    }
    const samePlayers =
      prior.players.map((value) => value.toLowerCase()).sort().join("+") ===
      card.players.map((value) => value.toLowerCase()).sort().join("+");
    if (samePlayers) {
      prior.teams = [...new Set([...prior.teams, ...card.teams])];
      continue;
    }
    prior.players = [...new Set([...prior.players, ...card.players])];
    prior.teams = [...new Set([...prior.teams, ...card.teams])];
    prior.rookieDesignation = prior.rookieDesignation || card.rookieDesignation;
    if (card.autographStatus === "autograph") prior.autographStatus = "autograph";
    if (card.memorabiliaStatus === "memorabilia") prior.memorabiliaStatus = "memorabilia";
    prior.sourceNotes = normalized(\`${'${prior.sourceNotes}'}; source-proven multi-subject card\`);
  }
`;

const after = `  const baseSubjectByNumber = new Map();
  for (const card of parsedCards) {
    if (card.setName.trim().toLowerCase() !== "base") continue;
    if (card.players.length !== 1) continue;
    baseSubjectByNumber.set(card.cardNumber.toLowerCase(), card.players[0].toLowerCase());
  }

  const deduped = [];
  const byIdentity = new Map();
  for (const card of parsedCards) {
    const key = \`${'${card.setName.toLowerCase()}'}::${'${card.cardNumber.toLowerCase()}'}\`;
    const prior = byIdentity.get(key);
    if (!prior) {
      byIdentity.set(key, card);
      deduped.push(card);
      continue;
    }
    const priorSubject = prior.players.map((value) => value.toLowerCase()).sort().join("+");
    const cardSubject = card.players.map((value) => value.toLowerCase()).sort().join("+");
    if (priorSubject === cardSubject) {
      prior.teams = [...new Set([...prior.teams, ...card.teams])];
      continue;
    }

    const baseSubject = baseSubjectByNumber.get(card.cardNumber.toLowerCase());
    if (baseSubject && card.players.length === 1 && prior.players.length === 1) {
      const priorMatchesBase = prior.players[0].toLowerCase() === baseSubject;
      const cardMatchesBase = card.players[0].toLowerCase() === baseSubject;
      if (priorMatchesBase !== cardMatchesBase) {
        if (cardMatchesBase) {
          const index = deduped.indexOf(prior);
          if (index >= 0) deduped[index] = card;
          byIdentity.set(key, card);
          card.sourceNotes = normalized(
            \`${'${card.sourceNotes}'}; duplicate source conflict resolved to Base checklist subject\`,
          );
        } else {
          prior.sourceNotes = normalized(
            \`${'${prior.sourceNotes}'}; duplicate source conflict resolved to Base checklist subject\`,
          );
        }
        continue;
      }
    }

    throw new Error(
      \`${'${target.name}'}: unresolved duplicate CARD SET/card number subject conflict: ${'${card.setName}'} #${'${card.cardNumber}'} -> ${'${prior.players.join(" / ")}'} vs ${'${card.players.join(" / ")}'}\`,
    );
  }
`;

if (!source.includes(before)) {
  throw new Error("Expected Panini dedupe block was not found; refusing to patch an unknown importer version.");
}
const patched = source.replace(before, after);
writeFileSync(path, patched, "utf8");
console.log("Patched Panini duplicate-subject conflict resolution to prefer the Base checklist subject.");
