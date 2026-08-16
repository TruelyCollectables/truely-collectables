import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetPath = resolve(process.cwd(), "scripts/import-hockey-2021plus-priority.mjs");
let source = readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}.`);
  }
  source = source.replace(before, after);
}

replaceOnce('  persistPlan,\n', '', 'remove legacy persistence import');
replaceOnce(
  '} from "./mainstream-checklist/registry-tools.mjs";\n',
  '} from "./mainstream-checklist/registry-tools.mjs";\nimport { persistChunkedPlan } from "./mainstream-checklist/chunked-registry-tools.mjs";\n',
  'add resumable chunked writer import',
);

replaceOnce(
  '  plan.adapterVersion = "1.0.0";\n',
  '  plan.adapterVersion = "1.2.0";\n',
  "Upper Deck chunked adapter-version bump",
);

replaceOnce(
`  const { data: proofRows, error: proofError } = await db
    .from("checklist_cards")
    .select("card_number,players,set_id")
    .eq("version_id", versionId)
    .in("card_number", proofNumbers);
  if (proofError) throw new Error(\`Could not verify proof cards: \${proofError.message}\`);
  for (const expectedProof of target.proofCards || []) {
    const ok = (proofRows || []).some((row) =>
      String(row.card_number).toLowerCase() === expectedProof.cardNumber.toLowerCase() &&
      (row.players || []).some((player) => String(player).toLowerCase().includes(expectedProof.subject.toLowerCase()))
    );
    if (!ok) throw new Error(\`Production proof card missing after import: \${expectedProof.cardNumber} \${expectedProof.subject}\`);
  }
  return { ok: true, versionId, cards: Number(count), proofCards: target.proofCards.length };
`,
`  const { data: proofRows, error: proofError } = await db
    .from("checklist_cards")
    .select("id,card_number,set_id")
    .eq("version_id", versionId)
    .in("card_number", proofNumbers);
  if (proofError) throw new Error(\`Could not verify proof cards: \${proofError.message}\`);

  const proofCardIds = [...new Set((proofRows || []).map((row) => row.id).filter(Boolean))];
  const playerNamesByCard = new Map();
  if (proofCardIds.length) {
    const { data: links, error: linkError } = await db
      .from("checklist_card_players")
      .select("card_id,player_id")
      .in("card_id", proofCardIds);
    if (linkError) throw new Error(\`Could not verify proof card-player links: \${linkError.message}\`);

    const playerIds = [...new Set((links || []).map((row) => row.player_id).filter(Boolean))];
    let players = [];
    if (playerIds.length) {
      const { data: playerRows, error: playerError } = await db
        .from("checklist_players")
        .select("id,canonical_name")
        .in("id", playerIds);
      if (playerError) throw new Error(\`Could not verify proof players: \${playerError.message}\`);
      players = playerRows || [];
    }
    const playerById = new Map(players.map((row) => [row.id, String(row.canonical_name || "")]));
    for (const link of links || []) {
      const names = playerNamesByCard.get(link.card_id) || [];
      const name = playerById.get(link.player_id);
      if (name) names.push(name);
      playerNamesByCard.set(link.card_id, names);
    }
  }

  for (const expectedProof of target.proofCards || []) {
    const ok = (proofRows || []).some((row) =>
      String(row.card_number).toLowerCase() === expectedProof.cardNumber.toLowerCase() &&
      (playerNamesByCard.get(row.id) || []).some((player) =>
        player.toLowerCase().includes(expectedProof.subject.toLowerCase()),
      )
    );
    if (!ok) throw new Error(\`Production proof card missing after import: \${expectedProof.cardNumber} \${expectedProof.subject}\`);
  }
  return { ok: true, versionId, cards: Number(count), proofCards: target.proofCards.length };
`,
  "Production proof-card join verifier",
);

replaceOnce(
  '  const persistence = await retry(`persist ${target.release.exactSetKey}`, () => persistPlan(db, plan, source.bytes), 4);\n',
  '  const persistence = await retry(`persist ${target.release.exactSetKey}`, () => persistChunkedPlan(db, plan, source.bytes), 4);\n',
  'switch hockey importer to resumable chunked writer',
);

writeFileSync(targetPath, source, "utf8");
console.log("Hockey priority importer patched: adapter 1.2.0 + resumable chunked writer + normalized proof verification.");