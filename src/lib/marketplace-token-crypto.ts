import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

type SellerMarketplaceOAuthState = {
  accountId: string;
  storeId: string;
  provider: "ebay";
  issuedAt: number;
  expiresAt: number;
};

type AdminMarketplaceOAuthState = {
  actor: "admin";
  storeId: string;
  provider: "ebay";
  issuedAt: number;
  expiresAt: number;
};

const MARKETPLACE_OAUTH_STATE_TTL_SECONDS = 60 * 10;

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

  return Buffer.from(`${normalized}${padding}`, "base64");
}

function signingSecret() {
  const secret =
    process.env.MARKETPLACE_OAUTH_STATE_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.EBAY_CLIENT_SECRET ||
    "";

  if (!secret) {
    throw new Error(
      "MARKETPLACE_OAUTH_STATE_SECRET, ADMIN_SESSION_SECRET, or EBAY_CLIENT_SECRET is required",
    );
  }

  return secret;
}

function encryptionKey() {
  const secret =
    process.env.MARKETPLACE_TOKEN_ENCRYPTION_KEY ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.EBAY_CLIENT_SECRET ||
    "";

  if (!secret) {
    throw new Error(
      "MARKETPLACE_TOKEN_ENCRYPTION_KEY, ADMIN_SESSION_SECRET, or EBAY_CLIENT_SECRET is required",
    );
  }

  return createHash("sha256").update(secret).digest();
}

function createMarketplaceOAuthState(
  payload:
    | Omit<SellerMarketplaceOAuthState, "issuedAt" | "expiresAt">
    | Omit<AdminMarketplaceOAuthState, "issuedAt" | "expiresAt">,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const signedPayload = {
    ...payload,
    issuedAt,
    expiresAt: issuedAt + MARKETPLACE_OAUTH_STATE_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(signedPayload));
  const signature = createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest();

  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

function parseMarketplaceOAuthState(value: string | null | undefined) {
  const [encodedPayload, encodedSignature] = String(value || "").split(".");

  if (!encodedPayload || !encodedSignature) {
    throw new Error("Missing or invalid OAuth state");
  }

  const expectedSignature = createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest();
  const providedSignature = base64UrlDecode(encodedSignature);

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error("OAuth state signature mismatch");
  }

  const payload = JSON.parse(
    base64UrlDecode(encodedPayload).toString("utf8"),
  ) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = Number(payload.issuedAt);
  const expiresAt = Number(payload.expiresAt);

  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now + 60 ||
    expiresAt <= issuedAt ||
    expiresAt < now
  ) {
    throw new Error("OAuth state has expired or has invalid timestamps");
  }

  return payload;
}

export function encryptMarketplaceToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    base64UrlEncode(iv),
    base64UrlEncode(authTag),
    base64UrlEncode(ciphertext),
  ].join(".");
}

export function decryptMarketplaceToken(payload: string) {
  const [version, ivPart, authTagPart, ciphertextPart] = String(payload || "").split(".");

  if (version !== "v1" || !ivPart || !authTagPart || !ciphertextPart) {
    throw new Error("Invalid marketplace token payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    base64UrlDecode(ivPart),
  );
  decipher.setAuthTag(base64UrlDecode(authTagPart));

  const plaintext = Buffer.concat([
    decipher.update(base64UrlDecode(ciphertextPart)),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

export function createSellerMarketplaceOAuthState(input: {
  accountId: string;
  storeId: string;
  provider: "ebay";
}) {
  return createMarketplaceOAuthState(input);
}

export function parseSellerMarketplaceOAuthState(value: string | null | undefined) {
  const payload = parseMarketplaceOAuthState(value);

  if (
    typeof payload.accountId !== "string" ||
    !payload.accountId ||
    typeof payload.storeId !== "string" ||
    !payload.storeId ||
    payload.provider !== "ebay" ||
    payload.actor !== undefined
  ) {
    throw new Error("Seller OAuth state payload is invalid");
  }

  return payload as SellerMarketplaceOAuthState;
}

export function createAdminMarketplaceOAuthState(input: {
  storeId: string;
  provider: "ebay";
}) {
  return createMarketplaceOAuthState({
    actor: "admin",
    ...input,
  });
}

export function parseAdminMarketplaceOAuthState(value: string | null | undefined) {
  const payload = parseMarketplaceOAuthState(value);

  if (
    payload.actor !== "admin" ||
    typeof payload.storeId !== "string" ||
    !payload.storeId ||
    payload.provider !== "ebay" ||
    payload.accountId !== undefined
  ) {
    throw new Error("Admin OAuth state payload is invalid");
  }

  return payload as AdminMarketplaceOAuthState;
}
