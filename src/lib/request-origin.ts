function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || "";
}

export function requestHost(request: Request) {
  return (
    firstHeaderValue(request.headers.get("x-forwarded-host")) ||
    firstHeaderValue(request.headers.get("host")) ||
    new URL(request.url).host
  );
}

export function requestProtocol(request: Request) {
  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );

  if (forwardedProtocol) {
    return forwardedProtocol.endsWith(":")
      ? forwardedProtocol
      : `${forwardedProtocol}:`;
  }

  return new URL(request.url).protocol;
}

export function requestOrigin(request: Request) {
  return `${requestProtocol(request)}//${requestHost(request)}`;
}

export function requestHostname(request: Request) {
  try {
    return new URL(requestOrigin(request)).hostname;
  } catch {
    return new URL(request.url).hostname;
  }
}
