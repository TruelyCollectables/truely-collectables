from pathlib import Path

for raw in [
    'scripts/instacomp-target-checklists/audit-upper-deck-hockey-2021plus-local.ts',
    'scripts/instacomp-target-checklists/recover-upper-deck-hockey-production.ts',
]:
    path = Path(raw)
    text = path.read_text()
    import_anchor = 'import type { ChecklistSourceArtifact } from "../../src/lib/checklist-registry/source-adapter";\n'
    if 'recover-upper-deck-hockey-production.ts' in raw:
        import_anchor = 'import type { ChecklistImportPlan, ChecklistSourceArtifact } from "../../src/lib/checklist-registry/source-adapter";\n'
    import_line = 'import { discoverUpperDeckHockeyCandidates, fetchUpperDeckHtml } from "./upper-deck-hockey-discovery";\n'
    if import_line not in text:
        if import_anchor not in text:
            raise SystemExit(f'Missing import anchor in {raw}')
        text = text.replace(import_anchor, import_anchor + import_line, 1)

    if 'audit-upper-deck' in raw:
        old = 'async function main(){mkdirSync(dirname(OUTPUT),{recursive:true}); const candidates=await discover();'
        new = 'async function main(){mkdirSync(dirname(OUTPUT),{recursive:true}); const discovery=await discoverUpperDeckHockeyCandidates(); const candidates=discovery.candidates;'
        text = text.replace('const content=await fetchHtml(candidate.url);', 'const content=await fetchUpperDeckHtml(candidate.url);')
    else:
        old = 'async function main(){mkdirSync(dirname(OUTPUT),{recursive:true});const candidates=await discover();'
        new = 'async function main(){mkdirSync(dirname(OUTPUT),{recursive:true});const discovery=await discoverUpperDeckHockeyCandidates();const candidates=discovery.candidates;'
        text = text.replace('const content=await fetchHtml(candidate.url);', 'const content=await fetchUpperDeckHtml(candidate.url);')
    if old not in text:
        raise SystemExit(f'Missing main discovery call in {raw}')
    text = text.replace(old, new, 1)
    path.write_text(text)
    print(f'Wired {raw} to proven Upper Deck discovery')
