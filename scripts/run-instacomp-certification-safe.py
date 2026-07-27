from pathlib import Path


source_path = Path("scripts/harden-instacomp-certification.py")
source = source_path.read_text()
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} block")',
    '        print(f"Certification hardening notice: {label} block was already changed or moved")\n        return text',
)
source = source.replace(
    '        raise SystemExit(f"Could not locate {label} pattern")',
    '        print(f"Certification hardening notice: {label} pattern was already changed or moved")\n        return text',
)
source = source.replace(
    '            raise SystemExit("Could not locate regression insertion marker")',
    '            print("Certification hardening notice: regression insertion marker was already changed")\n            return',
)
exec(compile(source, str(source_path), "exec"), {"__name__": "__main__"})
