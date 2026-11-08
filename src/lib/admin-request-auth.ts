import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "./admin-session";

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export async function hasValidAdminRequest(request: Request) {
  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    if (await isValidAdminSessionValue(cookieValue(request, cookieName))) {
      return true;
    }
  }
  return false;
}
