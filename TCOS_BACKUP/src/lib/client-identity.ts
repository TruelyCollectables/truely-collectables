export type ClientIdentityRisk = "verified" | "unchecked" | "blocked";

export type ClientIdentity = {
  ipAddress: string | null;
  userAgent: string | null;
  risk: ClientIdentityRisk;
  blocked: boolean;
  blockReason: string | null;
  evidence: Record<string, string | null>;
};

const IP_HEADER_NAMES = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
  "x-vercel-forwarded-for",
  "forwarded",
] as const;

function firstHeaderIp(value: string | null): string | null {
  if (!value) return null;

  const forwardedMatch = /for="?([^;,"]+)/i.exec(value);
  const rawValue = forwardedMatch?.[1] || value.split(",")[0];

  return rawValue
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/^::ffff:/i, "")
    .split(":")[0]
    .trim();
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");

  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function isPrivateOrReservedIpv4(value: string): boolean {
  if (!isIpv4(value)) return false;

  const [a, b] = value.split(".").map(Number);

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 0 && value.split(".")[2] === "2") ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateOrReservedIpv6(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isPrivateOrReservedIp(value: string): boolean {
  if (isIpv4(value)) return isPrivateOrReservedIpv4(value);

  return isPrivateOrReservedIpv6(value);
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function buildEvidence(headers: Headers): Record<string, string | null> {
  const evidence: Record<string, string | null> = {
    user_agent: truncate(headers.get("user-agent"), 500),
    accept_language: truncate(headers.get("accept-language"), 250),
    sec_ch_ua: truncate(headers.get("sec-ch-ua"), 250),
    sec_ch_ua_platform: truncate(headers.get("sec-ch-ua-platform"), 100),
    via: truncate(headers.get("via"), 250),
    forwarded: truncate(headers.get("forwarded"), 500),
  };

  for (const headerName of IP_HEADER_NAMES) {
    evidence[headerName.replaceAll("-", "_")] = truncate(
      headers.get(headerName),
      500,
    );
  }

  return evidence;
}

function getClientIp(headers: Headers): string | null {
  for (const headerName of IP_HEADER_NAMES) {
    const ipAddress = firstHeaderIp(headers.get(headerName));

    if (ipAddress) return ipAddress;
  }

  return null;
}

async function checkIpIntelligence(ipAddress: string): Promise<{
  blocked: boolean;
  reason: string | null;
  verified: boolean;
}> {
  const apiUrl = process.env.IP_INTELLIGENCE_API_URL;
  const required = process.env.IP_INTELLIGENCE_REQUIRED === "true";

  if (!apiUrl) {
    return {
      blocked: required,
      reason: required ? "ip_intelligence_not_configured" : null,
      verified: false,
    };
  }

  const url = apiUrl.includes("{ip}")
    ? apiUrl.replace("{ip}", encodeURIComponent(ipAddress))
    : `${apiUrl.replace(/\/$/, "")}/${encodeURIComponent(ipAddress)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (process.env.IP_INTELLIGENCE_API_KEY) {
    headers.Authorization = `Bearer ${process.env.IP_INTELLIGENCE_API_KEY}`;
  }

  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      blocked: required,
      reason: `ip_intelligence_unavailable_${response.status}`,
      verified: false,
    };
  }

  const data = await response.json();
  const serialized = JSON.stringify(data).toLowerCase();
  const blocked =
    data.proxy === true ||
    data.vpn === true ||
    data.tor === true ||
    data.hosting === true ||
    data.relay === true ||
    data.anonymous === true ||
    serialized.includes('"proxy":true') ||
    serialized.includes('"vpn":true') ||
    serialized.includes('"tor":true') ||
    serialized.includes('"hosting":true') ||
    serialized.includes('"anonymous":true');

  return {
    blocked,
    reason: blocked ? "masked_identity_detected" : null,
    verified: true,
  };
}

export async function getClientIdentity(request: Request): Promise<ClientIdentity> {
  const ipAddress = getClientIp(request.headers);
  const userAgent = truncate(request.headers.get("user-agent"), 500);
  const evidence = buildEvidence(request.headers);
  const allowPrivateIp = process.env.NODE_ENV !== "production";

  if (!ipAddress) {
    if (allowPrivateIp) {
      return {
        ipAddress: "development",
        userAgent,
        risk: "unchecked",
        blocked: false,
        blockReason: null,
        evidence,
      };
    }

    return {
      ipAddress: null,
      userAgent,
      risk: "blocked",
      blocked: true,
      blockReason: "missing_public_ip",
      evidence,
    };
  }

  if (isPrivateOrReservedIp(ipAddress) && !allowPrivateIp) {
    return {
      ipAddress,
      userAgent,
      risk: "blocked",
      blocked: true,
      blockReason: "private_or_reserved_ip",
      evidence,
    };
  }

  const intelligence = await checkIpIntelligence(ipAddress);

  if (intelligence.blocked) {
    return {
      ipAddress,
      userAgent,
      risk: "blocked",
      blocked: true,
      blockReason: intelligence.reason,
      evidence,
    };
  }

  return {
    ipAddress,
    userAgent,
    risk: intelligence.verified ? "verified" : "unchecked",
    blocked: false,
    blockReason: intelligence.reason,
    evidence,
  };
}

export function metadataSafeIdentity(identity: ClientIdentity) {
  return {
    tos_ip_address: identity.ipAddress || "",
    tos_user_agent: identity.userAgent || "",
    tos_ip_risk: identity.risk,
    tos_ip_block_reason: identity.blockReason || "",
  };
}
