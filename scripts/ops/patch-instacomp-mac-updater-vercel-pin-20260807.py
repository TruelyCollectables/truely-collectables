from pathlib import Path

path = Path('services/instacomp-ai/scripts/update-live-from-main.sh')
text = path.read_text(encoding='utf-8')

old = 'tunnel_url="https://${tunnel_hostname}"\n'
new = 'tunnel_url="https://${tunnel_hostname}"\nvercel_cli="vercel@56.2.0"\n'
if text.count(old) != 1:
    raise SystemExit(f'expected one tunnel URL marker, found {text.count(old)}')
text = text.replace(old, new, 1)

replacements = [
    ('printf \'%s\' "$value" | npx vercel env add "$name" "$environment" --force --sensitive >/dev/null',
     'printf \'%s\' "$value" | npx --yes "$vercel_cli" env add "$name" "$environment" --force --sensitive --cwd "$repo_root" >/dev/null'),
    ('printf \'%s\' "$value" | npx vercel env add "$name" "$environment" --force >/dev/null',
     'printf \'%s\' "$value" | npx --yes "$vercel_cli" env add "$name" "$environment" --force --cwd "$repo_root" >/dev/null'),
    ('npx vercel --prod --yes',
     'npx --yes "$vercel_cli" deploy --prod --yes --cwd "$repo_root"'),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f'expected one source block: {old!r}; found {text.count(old)}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Pinned InstaComp Mac updater to proven Vercel CLI 56.2.0: PASS')
