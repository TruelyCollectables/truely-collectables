export const ADMIN_HANDOFF_PARAM = "admin_handoff";

/**
 * Administrator sessions are cookie-only. This compatibility helper now
 * deliberately leaves links unchanged so a signed session can never enter a
 * URL, browser history, referrer, analytics record, screenshot, or log.
 */
export function addAdminHandoff(
  href: string,
  _handoff: string | null | undefined,
) {
  return href;
}

export function adminRedirectUrl(
  href: string,
  requestUrl: string,
  _handoff: string | null | undefined,
) {
  return new URL(href, requestUrl);
}

export function adminHandoffFromUrl(_url: URL) {
  return null;
}
