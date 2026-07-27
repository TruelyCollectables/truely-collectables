from pathlib import Path
import runpy

ROUTE_PATH = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not find expected {label} block.")
    return text.replace(old, new, 1)


def main() -> None:
    text = ROUTE_PATH.read_text()

    text = replace_once(
        text,
        '''function compactCardNumber(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}
''',
        '''function compactCardNumber(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function titleHasExactCardNumber(title: string, cardNumber: string) {
  const expected = compactCardNumber(cardNumber);
  if (!expected) return false;

  const escaped = normalized(cardNumber).replace(/\s+/g, "[-\\s]?");
  const explicit = new RegExp(
    `(?:#|card(?:\\s*(?:no\\.?|number))?)\\s*${escaped}(?![a-z0-9])`,
    "i",
  );
  if (explicit.test(title)) return true;

  const tokens = clean(title).match(/[a-z0-9]+(?:-[a-z0-9]+)*/gi) || [];
  const disallowedPrevious = new Set([
    "series",
    "season",
    "year",
    "lot",
    "qty",
    "quantity",
    "box",
    "case",
    "of",
  ]);
  return tokens.some((token, index) => {
    if (compactCardNumber(token) !== expected) return false;
    const previous = normalized(tokens[index - 1]);
    if (disallowedPrevious.has(previous)) return false;
    const occurrence = title.toLowerCase().indexOf(token.toLowerCase());
    if (occurrence > 0 && title[occurrence - 1] === "/") return false;
    return true;
  });
}
''',
        "card-number helper",
    )

    text = replace_once(
        text,
        '''function rejectedTitle(title: string) {
  return /\b(?:lot|team set|complete set|reprint|custom|digital|nft|break|you pick|choose your card|psa|bgs|sgc|cgc|graded|gem mint)\b/i.test(
    title,
  );
}
''',
        '''function rejectedTitle(title: string) {
  return /\b(?:lot|team set|complete set|reprint|custom|digital|nft|break|you pick|choose your card|psa|bgs|sgc|cgc|graded|gem mint|oversized|oversize|jumbo|mini|box topper|5x7|8x10|promo)\b/i.test(
    title,
  );
}
''',
        "title rejection",
    )

    text = replace_once(
        text,
        '''  const numberPass = text.replace(/[^a-z0-9]/g, "").includes(compactCardNumber(expected.cardNumber));
''',
        '''  const numberPass = titleHasExactCardNumber(title, expected.cardNumber);
''',
        "title card-number match",
    )

    text = replace_once(
        text,
        '''async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "TCOS-InstaComp-Benchmark/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${fileName} (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${fileName} was empty or exceeded 12 MB.`);
  }
  const reportedType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
  const inferredType = /\.png(?:\?|$)/i.test(url)
    ? "image/png"
    : /\.webp(?:\?|$)/i.test(url)
      ? "image/webp"
      : "image/jpeg";
  const type = ALLOWED_IMAGE_TYPES.has(reportedType) ? reportedType : inferredType;
  return new File([bytes], fileName, { type });
}
''',
        '''function imageTypeFromMagic(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
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

async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "TCOS-InstaComp-Benchmark/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${fileName} (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${fileName} was empty or exceeded 12 MB.`);
  }
  const bytes = new Uint8Array(buffer);
  const type = imageTypeFromMagic(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
    const reportedType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
    throw new Error(
      `${fileName} was not a real JPEG, PNG, or WebP image (reported ${reportedType || "unknown"}).`,
    );
  }
  return new File([buffer], fileName, { type });
}
''',
        "image downloader",
    )

    ROUTE_PATH.write_text(text)
    runpy.run_path("scripts/run-instacomp-catalog-registry-safe.py", run_name="__main__")


if __name__ == "__main__":
    main()
