import { timingSafeEqual } from "node:crypto";

function constantTimeEqual(provided: string, expected: string) {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function getInstaCompSentinelArchiveToken() {
  return String(process.env.INSTACOMP_SENTINEL_ARCHIVE_TOKEN || "").trim();
}

export function isValidInstaCompSentinelArchiveRequest(request: Request) {
  const expected = getInstaCompSentinelArchiveToken();
  const provided = String(
    request.headers.get("x-instacomp-sentinel-archive-token") || "",
  ).trim();
  return Boolean(expected && provided && constantTimeEqual(provided, expected));
}
