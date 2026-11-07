from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/lib/instacomp-job-server.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    text = TARGET.read_text(encoding="utf-8")

    if 'import { timingSafeEqual } from "node:crypto";' not in text:
        text = 'import { timingSafeEqual } from "node:crypto";\n' + text

    bearer_block = '''function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  return scheme.toLowerCase() === "bearer" && token?.trim()
    ? token.trim()
    : null;
}
'''
    service_block = bearer_block + '''
function constantTimeSecretMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function isValidInstaCompServiceRequest(
  request: Request,
  expectedToken = process.env.INSTACOMP_SERVICE_TOKEN,
) {
  const expected = String(expectedToken || "").trim();
  const provided = String(
    request.headers.get("x-tcos-instacomp-service-token") || "",
  ).trim();

  return Boolean(
    expected && provided && constantTimeSecretMatch(provided, expected),
  );
}
'''
    text = replace_once(
        text,
        bearer_block,
        service_block,
        "service authentication helper insertion",
    )

    actor_marker = '''  const storeId = getActiveStoreId();
  const token = bearerToken(request);
'''
    actor_replacement = '''  const storeId = getActiveStoreId();

  // Profit Hunter and Market Intel use a dedicated service credential. This
  // keeps reusable seller JWTs and administrator cookies out of background
  // connector infrastructure while preserving the same private store scope.
  if (isValidInstaCompServiceRequest(request)) {
    return {
      type: "admin",
      storeId,
      sellerAccountId: null,
    };
  }

  const token = bearerToken(request);
'''
    text = replace_once(
        text,
        actor_marker,
        actor_replacement,
        "service actor insertion",
    )

    TARGET.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
