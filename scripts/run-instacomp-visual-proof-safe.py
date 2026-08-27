from pathlib import Path


source_path = Path("scripts/harden-instacomp-visual-proof.py")
source = source_path.read_text()
source = source.replace(
    "    patch_live_scan_visual_proof()\n",
    '''    live_source = Path("src/app/api/instacomp/live-scan/route.ts").read_text()
    if all(
        marker in live_source
        for marker in (
            "function forceVisualProof(",
            "function providerAfterVisualReview(",
            "const visualTarget = targetFrontImage;",
            "visualProof: {",
        )
    ):
        print("Visual-proof hardening notice: final live visual proof already exists; skipping helper insertion")
    else:
        patch_live_scan_visual_proof()
''',
)
exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "Path": Path})
