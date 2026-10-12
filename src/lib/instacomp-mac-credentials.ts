function parseConfiguredUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (process.env.KINGMAKER_LOCAL_MAC_BRIDGE === "1" && url.origin === "http://127.0.0.1:8787" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash) return "http://127.0.0.1:8787";
    if (
      process.env.NODE_ENV === "production" &&
      /^(?:127\.0\.0\.1|localhost)$/i.test(url.hostname)
    ) {
      return null;
    }
    if (
      url.hostname !== "truelycollectables.com" &&
      !url.hostname.endsWith(".truelycollectables.com")
    ) {
      return null;
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (
      url.hostname === "truelycollectables.com" &&
      pathname !== "/instacomp" &&
      !pathname.startsWith("/instacomp/")
    ) {
      return null;
    }
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return null;
  }
}

export function getConfiguredInstaCompMacUrl() {
  if (process.env.KINGMAKER_LOCAL_MAC_BRIDGE === "1") return parseConfiguredUrl("http://127.0.0.1:8787");
  return parseConfiguredUrl(String(process.env.INSTACOMP_AI_LOCAL_URL || "https://instacomp.truelycollectables.com").trim());
}

export function isTrustedInstaCompMacUrl(value: string | null | undefined) {
  return Boolean(parseConfiguredUrl(String(value || "").trim()));
}

export function getConfiguredInstaCompMacKey() {
  return (
    String(
      process.env.INSTACOMP_AI_LOCAL_KEY || process.env.INSTACOMP_AI_API_KEY || "",
    ).trim() || null
  );
}
