from pathlib import Path

runtime_path = Path("src/app/api/account/seller/instacomp-scan/intake/route.ts")
runtime = runtime_path.read_text()
old_runtime = '''    const frontFile =
      front instanceof File
        ? front
        : new File([front], "front-upload.jpg", {
            type: front.type || "image/jpeg",
          });
    const backFile =
      back instanceof File
        ? back
        : new File([back], "back-upload.jpg", {
            type: back.type || "image/jpeg",
          });'''
new_runtime = '''    const frontFile = front;
    const backFile = back;'''
count = runtime.count(old_runtime)
if count != 1:
    raise SystemExit(f"Expected one impossible File fallback block in runtime, found {count}.")
runtime_path.write_text(runtime.replace(old_runtime, new_runtime, 1))

patcher_path = Path("scripts/patch-instacomp-auto-orientation-base.py")
patcher = patcher_path.read_text()
old_patcher = '''    \"\"\"    const frontFile =\\n      front instanceof File\\n        ? front\\n        : new File([front], \\\"front-upload.jpg\\\", {\\n            type: front.type || \\\"image/jpeg\\\",\\n          });\\n    const backFile =\\n      back instanceof File\\n        ? back\\n        : new File([back], \\\"back-upload.jpg\\\", {\\n            type: back.type || \\\"image/jpeg\\\",\\n          });\\n    const normalizedSides = await normalizeInstaCompSideImages({\"\"\",'''
new_patcher = '''    \"\"\"    const frontFile = front;\\n    const backFile = back;\\n    const normalizedSides = await normalizeInstaCompSideImages({\"\"\",'''
count = patcher.count(old_patcher)
if count != 1:
    raise SystemExit(f"Expected one impossible File fallback block in patcher, found {count}.")
patcher_path.write_text(patcher.replace(old_patcher, new_patcher, 1))

print("Fixed impossible File fallback in runtime and patch generator.")
