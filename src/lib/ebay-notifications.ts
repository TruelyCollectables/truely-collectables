import { createHash, createVerify } from "node:crypto";

type EbaySignatureHeader = {
  kid: string;
  signature: string;
};

type EbayPublicKey = {
  algorithm: string;
  digest: string;
  key: string;
};

type CachedValue<T> = {
  value: T;
  expiresAt: number;
};

const publicKeyCache = new Map<string, CachedValue<EbayPublicKey>>();
let applicationTokenCache: CachedValue<string> | null = null;

function ebayEnvironment() {
  return String(
    process.env.EBAY_NOTIFICATION_ENVIRONMENT ||
      process.env.EBAY_ENVIRONMENT ||
      "production",
  ).toLowerCase() === "sandbox"
    ? "sandbox"
    : "production";
}

function ebayApiBase() {
  return ebayEnvironment() === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function parseSignatureHeader(value: string): EbaySignatureHeader {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    throw new Error("Invalid X-EBAY-SIGNATURE encoding");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid X-EBAY-SIGNATURE payload");
  }

  const record = parsed as Record<string, unknown>;
  const kid = String(record.kid || "").trim();
  const signature = String(record.signature || "").trim();

  if (!kid || !signature || kid.length > 200 || signature.length > 2000) {
    throw new Error("X-EBAY-SIGNATURE is missing required values");
  }

  return { kid, signature };
}

function formatPublicKey(value: string) {
  return value
    .replace(/-----BEGIN PUBLIC KEY-----\s*/, "-----BEGIN PUBLIC KEY-----\n")
    .replace(/\s*-----END PUBLIC KEY-----/, "\n-----END PUBLIC KEY-----");
}

async function getApplicationToken() {
  if (
    applicationTokenCache &&
    applicationTokenCache.expiresAt - Date.now() > 60_000
  ) {
    return applicationTokenCache.value;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const response = await fetch(`${ebayApiBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    throw new Error(
      data?.error_description ||
        data?.error ||
        "Could not obtain an eBay application token",
    );
  }

  const expiresIn = Math.max(Number(data.expires_in || 7200), 60);
  applicationTokenCache = {
    value: String(data.access_token),
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return applicationTokenCache.value;
}

async function getPublicKey(keyId: string) {
  const cacheKey = `${ebayEnvironment()}:${keyId}`;
  const cached = publicKeyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const accessToken = await getApplicationToken();
  const response = await fetch(
    `${ebayApiBase()}/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  const data = await response.json().catch(() => ({}));

  if (
    !response.ok ||
    !data?.key ||
    String(data.algorithm || "").toUpperCase() !== "ECDSA"
  ) {
    throw new Error("Could not retrieve a valid eBay notification public key");
  }

  const publicKey: EbayPublicKey = {
    algorithm: String(data.algorithm),
    digest: String(data.digest || "SHA1"),
    key: String(data.key),
  };
  publicKeyCache.set(cacheKey, {
    value: publicKey,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });

  return publicKey;
}

function verificationAlgorithm(digest: string) {
  const normalized = digest.replaceAll("-", "").toUpperCase();

  if (normalized === "SHA1") return "sha1";
  if (normalized === "SHA256") return "sha256";

  throw new Error(`Unsupported eBay notification digest: ${digest}`);
}

export function ebayNotificationChallengeResponse(params: {
  challengeCode: string;
  endpoint: string;
}) {
  const verificationToken = String(
    process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN || "",
  ).trim();

  if (!/^[A-Za-z0-9_-]{32,80}$/.test(verificationToken)) {
    throw new Error(
      "EBAY_NOTIFICATION_VERIFICATION_TOKEN must be 32-80 letters, numbers, underscores, or hyphens",
    );
  }

  return createHash("sha256")
    .update(params.challengeCode)
    .update(verificationToken)
    .update(params.endpoint)
    .digest("hex");
}

export async function verifyEbayNotification(params: {
  message: unknown;
  signatureHeader: string;
}) {
  const signature = parseSignatureHeader(params.signatureHeader);
  const publicKey = await getPublicKey(signature.kid);
  const verifier = createVerify(verificationAlgorithm(publicKey.digest));
  verifier.update(JSON.stringify(params.message));
  verifier.end();

  return {
    valid: verifier.verify(
      formatPublicKey(publicKey.key),
      signature.signature,
      "base64",
    ),
    keyId: signature.kid,
  };
}
