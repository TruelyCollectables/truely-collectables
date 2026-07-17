export const ADMIN_HANDOFF_PARAM = "admin_handoff";

export function addAdminHandoff(
  href: string,
  handoff: string | null | undefined,
) {
  if (
    !handoff ||
    href === "/admin/logout" ||
    (!href.startsWith("/admin") && !href.startsWith("/api/admin"))
  ) {
    return href;
  }

  const [pathAndQuery, hash = ""] = href.split("#", 2);
  const [path, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);

  params.set(ADMIN_HANDOFF_PARAM, handoff);

  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

export function adminRedirectUrl(
  href: string,
  requestUrl: string,
  handoff: string | null | undefined,
) {
  return new URL(addAdminHandoff(href, handoff), requestUrl);
}

export function adminHandoffFromUrl(url: URL) {
  return url.searchParams.get(ADMIN_HANDOFF_PARAM);
}
