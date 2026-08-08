from pathlib import Path

route = Path('src/app/api/instacomp/scan/route.ts')
text = route.read_text(encoding='utf-8')

anchor = 'import { normalizeInstaCompSideImages } from "../../../../lib/instacomp-image-orientation";\n'
addition = anchor + 'import { extractInstaCompUntrustedListingIdentityHint } from "../../../../lib/instacomp-listing-identity-hint";\n'
if anchor not in text:
    raise SystemExit('Import anchor missing; refusing fuzzy patch.')
text = text.replace(anchor, addition, 1)

start = text.find('function extractUntrustedListingIdentityHint(value: unknown) {')
end_anchor = '\n\nasync function identifyCardWithConfiguredProviderFailover'
end = text.find(end_anchor, start)
if start < 0 or end < 0:
    raise SystemExit('Legacy listing hint helper block missing; refusing fuzzy patch.')
wrapper = '''function extractUntrustedListingIdentityHint(value: unknown) {\n  return extractInstaCompUntrustedListingIdentityHint(value);\n}\n'''
text = text[:start] + wrapper + text[end:]
route.write_text(text, encoding='utf-8')
print('Bounded untrusted listing hint parser wired into scan route.')
