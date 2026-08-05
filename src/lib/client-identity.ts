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

  const forwardedMatch = /for="?([^;,\"]+)/i.exec(value);
  const rawValue = forwardedMatch?.[1] || value.split(",")[0];

  return rawValue
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/^::ffff:/i, "")
    .split(":")[0]
    .trim();
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
  observedRisk: string | null;
  verified: boolean;
}> {
  const apiUrl = process.env.IP_INTELLIGENCE_API_URL;

  if (!apiUrl) {
    return {
      observedRisk: null,
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

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        observedRisk: `ip_intelligence_unavailable_${response.status}`,
        verified: false,
      };
    }

    const data = await response.json();
    const serialized = JSON.stringify(data).toLowerCase();
    const observedRisk =
      data.proxy === true || serialized.includes('"proxy":true')
        ? "proxy_reported"
        : data.vpn === true || serialized.includes('"vpn":true')
          ? "vpn_reported"
          : data.tor === true || serialized.includes('"tor":true')
            ? "tor_reported"
            : data.hosting === true || serialized.includes('"hosting":true')
              ? "hosting_reported"
              : data.relay === true || serialized.includes('"relay":true')
                ? "relay_reported"
                : data.anonymous === true || serialized.includes('"anonymous":true')
                  ? "anonymous_reported"
                  : null;

    return {
      observedRisk,
      verified: true,
    };
  } catch {
    return {
      observedRisk: "ip_intelligence_unavailable",
      verified: false,
    };
  }
}

export async function getClientIdentity(request: Request): Promise<ClientIdentity> {
  const ipAddress = getClientIp(request.headers);
  const userAgent = truncate(request.headers.get("user-agent"), 500);
  const evidence = buildEvidence(request.headers);

  if (!ipAddress) {
    return {
      ipAddress: null,
      userAgent,
      risk: "unchecked",
      blocked: false,
      blockReason: null,
      evidence: {
        ...evidence,
        ip_intelligence_observation: "missing_public_ip",
      },
    };
  }

  const intelligence = await checkIpIntelligence(ipAddress);

  return {
    ipAddress,
    userAgent,
    risk: intelligence.verified ? "verified" : "unchecked",
    blocked: false,
    blockReason: null,
    evidence: {
      ...evidence,
      ip_intelligence_observation: intelligence.observedRisk,
    },
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
