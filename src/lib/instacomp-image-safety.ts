export type InstaCompImageMime = "image/jpeg" | "image/png" | "image/webp";

function byteView(value: ArrayBuffer | Uint8Array) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function detectInstaCompImageMime(
  value: ArrayBuffer | Uint8Array,
): InstaCompImageMime | null {
  const bytes = byteView(value);
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function instaCompImageExtension(mime: InstaCompImageMime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function instaCompImageDataUrl(
  value: ArrayBuffer | Uint8Array,
  mime?: InstaCompImageMime | null,
) {
  const bytes = byteView(value);
  const detected = mime || detectInstaCompImageMime(bytes);
  if (!detected) {
    throw new Error("Image bytes were not a real JPEG, PNG, or WebP file.");
  }
  return `data:${detected};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function readValidatedInstaCompImage(
  file: File,
  label: string,
): Promise<{
  bytes: Uint8Array;
  mime: InstaCompImageMime;
  dataUrl: string;
}> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectInstaCompImageMime(bytes);
  if (!mime) {
    throw new Error(`${label} was not a real JPEG, PNG, or WebP image.`);
  }
  return {
    bytes,
    mime,
    dataUrl: instaCompImageDataUrl(bytes, mime),
  };
}
