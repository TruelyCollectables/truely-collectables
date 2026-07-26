from pathlib import Path

route = Path("src/app/api/account/seller/inventory/instacomp/route.ts")
text = route.read_text(encoding="utf-8")
text = text.replace("comp?.flags.some((flag) =>", "comp?.flags.some((flag: string) =>")
text = text.replace("comp.flags.some((flag) =>", "comp.flags.some((flag: string) =>")
route.write_text(text, encoding="utf-8")
Path("scripts/temp-fix-instacomp-comp-typing.py").unlink(missing_ok=True)
Path(".github/workflows/temp-fix-instacomp-comp-typing.yml").unlink(missing_ok=True)
