from pathlib import Path


path = Path("scripts/run-instacomp-final-audit-regressions.ts")
text = path.read_text()
old = '''const sourcePng = await sharp({
  create: { width: 2, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).png().toBuffer();
assert.equal(detectInstaCompImageMime(sourcePng), "image/png");
const rotatedPng = await rotateInstaCompImageBytes({
  bytes: new Uint8Array(sourcePng),
  mime: "image/png",
  rotation: 90,
});
const rotatedMetadata = await sharp(rotatedPng).metadata();
assert.equal(rotatedMetadata.width, 1);
assert.equal(rotatedMetadata.height, 2);

console.log("InstaComp final adversarial audit regressions passed.");
'''
new = '''async function runImageSafetyRegressions() {
  const sourcePng = await sharp({
    create: { width: 2, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();
  assert.equal(detectInstaCompImageMime(sourcePng), "image/png");
  const rotatedPng = await rotateInstaCompImageBytes({
    bytes: new Uint8Array(sourcePng),
    mime: "image/png",
    rotation: 90,
  });
  const rotatedMetadata = await sharp(rotatedPng).metadata();
  assert.equal(rotatedMetadata.width, 1);
  assert.equal(rotatedMetadata.height, 2);
}

runImageSafetyRegressions()
  .then(() => {
    console.log("InstaComp final adversarial audit regressions passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
'''
if new not in text:
    if old not in text:
        raise SystemExit("Could not locate the final image regression block")
    text = text.replace(old, new, 1)
path.write_text(text)
