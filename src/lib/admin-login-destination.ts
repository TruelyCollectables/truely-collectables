export function safeAdminLoginNextPath(value: unknown) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const nextPath = typeof rawValue === "string" ? rawValue : "";

  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/admin";
  }

  let pathname = nextPath;

  try {
    pathname = new URL(nextPath, "https://admin.local").pathname;
  } catch {
    return "/admin";
  }

  if (pathname === "/admin/login" || pathname === "/admin/logout") {
    return "/admin";
  }

  if (pathname === "/api/admin/login" || pathname === "/api/admin/logout") {
    return "/admin";
  }

  return nextPath;
}
