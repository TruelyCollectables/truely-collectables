import fs from "node:fs";
import sharp from "sharp";

const policy = fs.readFileSync(
  "src/lib/card-scan-frame-policy.ts",
  "utf8",
);
const guard = fs.readFileSync(
  "src/app/components/WholeCardUploadGuard.tsx",
  "utf8",
);
const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const globalCss = fs.readFileSync("src/app/globals.css", "utf8");
const orientation = fs.readFileSync(
  "src/lib/instacomp-image-orientation.ts",
  "utf8",
);

const ratioMatch = policy.match(/CARD_SCAN_FRAME_RATIO\s*=\s*([0-9.]+)/);
const minimumMatch = policy.match(
  /CARD_SCAN_FRAME_MIN_PIXELS\s*=\s*([0-9]+)/,
);
const maximumMatch = policy.match(
  /CARD_SCAN_FRAME_MAX_PIXELS\s*=\s*([0-9]+)/,
);
const ratio = Number(ratioMatch?.[1]);
const minimum = Number(minimumMatch?.[1]);
const maximum = Number(maximumMatch?.[1]);

function framePixels(dimension) {
  return Math.min(maximum, Math.max(minimum, Math.round(dimension * ratio)));
}

const checks = [
  ["frame policy is five percent", ratio === 0.05],
  ["frame policy has bounded minimum and maximum", minimum === 24 && maximum === 180],
  [
    "browser guard covers package intake",
    guard.includes('"/api/admin/pending-card-import"'),
  ],
  [
    "browser guard covers Quick List",
    guard.includes('"/api/admin/quick-list"'),
  ],
  [
    "browser guard covers InstaComp scans and drafts",
    guard.includes('"/api/instacomp/scan-fast"') &&
      guard.includes('"/api/instacomp/draft-listings"'),
  ],
  [
    "browser guard transforms only complete front and back images",
    guard.includes("FULL_CARD_IMAGE_FIELD") &&
      guard.includes("detailImages") === false,
  ],
  [
    "browser guard fails closed instead of silently uploading a tight scan",
    guard.includes("Upload stopped instead of saving a tight or cropped-looking scan"),
  ],
  [
    "whole-card guard is mounted site-wide",
    layout.includes("<WholeCardUploadGuard />"),
  ],
  [
    "storefront card frames retain visible breathing room",
    globalCss.includes('[class*="aspect-[4/5]"] > img[class*="object-contain"]'),
  ],
  [
    "server-side InstaComp normalization extends the image canvas",
    orientation.includes("cardScanFrameInsets") && orientation.includes(".extend({"),
  ],
  [
    "normalized InstaComp files are marked as whole-card images",
    orientation.includes("front-normalized-whole-card") &&
      orientation.includes("back-normalized-whole-card"),
  ],
];

let failures = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failures += 1;
}

const sourceWidth = 800;
const sourceHeight = 1120;
const horizontal = framePixels(sourceWidth);
const vertical = framePixels(sourceHeight);
const source = await sharp({
  create: {
    width: sourceWidth,
    height: sourceHeight,
    channels: 3,
    background: "#ffffff",
  },
})
  .png()
  .toBuffer();
const framed = await sharp(source)
  .extend({
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
    background: { r: 229, g: 231, b: 235, alpha: 1 },
  })
  .jpeg({ quality: 95 })
  .toBuffer();
const metadata = await sharp(framed).metadata();
const expectedWidth = sourceWidth + horizontal * 2;
const expectedHeight = sourceHeight + vertical * 2;
const imageSmokePassed =
  metadata.width === expectedWidth && metadata.height === expectedHeight;
console.log(
  `${imageSmokePassed ? "PASS" : "FAIL"} Sharp smoke image is ${expectedWidth}x${expectedHeight}`,
);
if (!imageSmokePassed) failures += 1;

if (failures > 0) {
  console.error(`Whole-card scan audit failed ${failures}/${checks.length + 1} checks.`);
  process.exit(1);
}

console.log(`Whole-card scan audit passed ${checks.length + 1}/${checks.length + 1} checks.`);
