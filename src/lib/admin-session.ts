const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export const ADMIN_SESSION_COOKIE_NAME = "tcos_admin_auth_v2";
export const LEGACY_ADMIN_SESSION_COOKIE_NAME = "admin_auth";

type AdminSessionCookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export function adminSessionCookieOptions(
  maxAge = ADMIN_SESSION_MAX_AGE_SECONDS,
): AdminSessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

export function expiredAdminSessionCookieOptions(): AdminSessionCookieOptions {
  return adminSessionCookieOptions(0);
}

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

async function digest(value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));

  return new Uint8Array(hash);
}

function safeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return mismatch === 0;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedPassword) return false;

  const [providedHash, expectedHash] = await Promise.all([
    digest(password),
    digest(expectedPassword),
  ]);

  return safeBytesEqual(providedHash, expectedHash);
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
