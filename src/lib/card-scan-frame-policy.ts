export const CARD_SCAN_FRAME_VERSION = "whole-card-v1";
export const CARD_SCAN_FRAME_RATIO = 0.05;
export const CARD_SCAN_FRAME_MIN_PIXELS = 24;
export const CARD_SCAN_FRAME_MAX_PIXELS = 180;
export const CARD_SCAN_FRAME_CSS_COLOR = "#e5e7eb";
export const CARD_SCAN_FRAME_SHARP_COLOR = {
  r: 229,
  g: 231,
  b: 235,
  alpha: 1,
} as const;

function framePixels(dimension: number) {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0;

  return Math.min(
    CARD_SCAN_FRAME_MAX_PIXELS,
    Math.max(
      CARD_SCAN_FRAME_MIN_PIXELS,
      Math.round(dimension * CARD_SCAN_FRAME_RATIO),
    ),
  );
}

export function cardScanFrameInsets(width: number, height: number) {
  const horizontal = framePixels(width);
  const vertical = framePixels(height);

  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  } as const;
}
