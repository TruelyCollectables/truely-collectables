const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

function getSessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return toBase64Url(signature);
}

export async function createAdminSessionValue(): Promise<string> {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("ADMIN_PASSWORD or ADMIN_SESSION_SECRET is required");
  }

  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = await sign(issuedAt, secret);

  return `${issuedAt}.${signature}`;
}

export async function isValidAdminSessionValue(
  sessionValue: string | undefined,
): Promise<boolean> {
  const secret = getSessionSecret();

  if (!sessionValue || !secret) return false;

  const [issuedAt, providedSignature] = sessionValue.split(".");

  if (!issuedAt || !providedSignature) return false;

  const issuedAtSeconds = Number(issuedAt);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(issuedAtSeconds)) return false;
  if (issuedAtSeconds > nowSeconds + 60) return false;
  if (nowSeconds - issuedAtSeconds > ADMIN_SESSION_MAX_AGE_SECONDS) return false;

  const expectedSignature = await sign(issuedAt, secret);

  return safeEqual(providedSignature, expectedSignature);
}

export const adminSessionMaxAgeSeconds = ADMIN_SESSION_MAX_AGE_SECONDS;
