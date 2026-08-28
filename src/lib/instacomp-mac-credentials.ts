export function getConfiguredInstaCompMacUrl() {
  const value = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) return null;
  if (
    process.env.NODE_ENV === "production" &&
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(value)
  ) {
    return null;
  }
  return value;
}

export function getConfiguredInstaCompMacKey() {
  return (
    String(
      process.env.INSTACOMP_AI_LOCAL_KEY || process.env.INSTACOMP_AI_API_KEY || "",
    ).trim() || null
  );
}
