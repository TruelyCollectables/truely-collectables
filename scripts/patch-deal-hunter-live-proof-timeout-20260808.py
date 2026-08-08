from pathlib import Path

route = Path('src/app/api/release/instacomp-deal-hunter-learning-self-test/route.ts')
text = route.read_text(encoding='utf-8')
replacements = {
    'export const maxDuration = 300;': 'export const maxDuration = 800;',
    'for (let attempt = 0; attempt < 44; attempt += 1) {': 'for (let attempt = 0; attempt < 120; attempt += 1) {',
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(f'Expected exactly one timeout anchor: {old!r}')
    text = text.replace(old, new, 1)
route.write_text(text, encoding='utf-8')
print('Deal Hunter live-proof bounded timeout extended for strict long-running batches.')
