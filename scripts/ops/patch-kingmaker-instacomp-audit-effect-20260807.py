from pathlib import Path

path = Path('src/app/kingmaker/instacomp-audit/page.tsx')
text = path.read_text(encoding='utf-8')
old = '''  useEffect(() => {\n    void load();\n  }, [load]);'''
new = '''  useEffect(() => {\n    const timer = window.setTimeout(() => {\n      void load();\n    }, 0);\n    return () => window.clearTimeout(timer);\n  }, [load]);'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'Expected exactly one initial-load effect anchor, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('PASS applied exact KINGMAKER audit initial-load effect repair')
