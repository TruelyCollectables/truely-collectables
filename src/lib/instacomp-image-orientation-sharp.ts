import sharp from "sharp";
import {
  CARD_SCAN_FRAME_SHARP_COLOR,
  cardScanFrameInsets,
} from "./card-scan-frame-policy";
import type { InstaCompImageMime } from "./instacomp-image-safety";

const MAX_ORIENTATION_INPUT_PIXELS = 40_000_000;

export async function rotateInstaCompImageBytesWithSharp(params: {
  bytes: Uint8Array;
  mime: InstaCompImageMime;
  rotation: 0 | 90 | 180 | 270;
  addScanFrame?: boolean;
}) {
  const normalized = await sharp(Buffer.from(params.bytes), {
    failOn: "warning",
    limitInputPixels: MAX_ORIENTATION_INPUT_PIXELS,
  })
    .autoOrient()
    .rotate(params.rotation)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let pipeline = sharp(normalized.data, {
    raw: {
      width: normalized.info.width,
      height: normalized.info.height,
      channels: normalized.info.channels,
    },
  });

  if (params.addScanFrame !== false) {
    const frame = cardScanFrameInsets(
      normalized.info.width,
      normalized.info.height,
    );
    pipeline = pipeline.extend({
      ...frame,
      background: CARD_SCAN_FRAME_SHARP_COLOR,
    });
  }

  pipeline = pipeline.flatten({ background: CARD_SCAN_FRAME_SHARP_COLOR });

  if (params.mime === "image/png") pipeline = pipeline.png();
  else if (params.mime === "image/webp") pipeline = pipeline.webp({ quality: 95 });
  else pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });

  return new Uint8Array(await pipeline.toBuffer());
}
