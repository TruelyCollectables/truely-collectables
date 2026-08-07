from pathlib import Path

path = Path("scripts/run-instacomp-final-identity-consensus-simulations.ts")
text = path.read_text(encoding="utf-8")
needle = "assert.equal(iceConsensus.trustedForIdentity, true);"
replacement = '''console.log("ICE_CONSENSUS_DEBUG=" + JSON.stringify(iceConsensus, null, 2));
assert.equal(iceConsensus.trustedForIdentity, true);'''
if needle not in text:
    raise SystemExit("Ice consensus assertion not found")
path.write_text(text.replace(needle, replacement, 1), encoding="utf-8")
print("PASS instrumented Ice consensus simulation")
