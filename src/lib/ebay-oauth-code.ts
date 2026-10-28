/**
 * Read the OAuth authorization code from its raw URL query component.
 *
 * URLSearchParams implements application/x-www-form-urlencoded decoding and
 * turns literal '+' into a space. OAuth authorization codes are opaque and
 * may legitimately contain '+'; preserve that character while decoding
 * percent escapes exactly once.
 */
export function readEbayAuthorizationCode(requestUrl: string): string | null {
  let query: string;
  try {
    query = new URL(requestUrl).search.slice(1);
  } catch {
    return null;
  }

  const pair = query.split("&").find((part) => part.startsWith("code="));
  if (!pair) return null;

  try {
    const code = decodeURIComponent(pair.slice("code=".length));
    if (!code || code.length > 8192 || /\s/.test(code)) return null;
    return code;
  } catch {
    return null;
  }
}
