import { createHmac, timingSafeEqual } from "node:crypto";

export type SocialProvider = "facebook" | "instagram" | "threads" | "pinterest" | "tiktok" | "x";

type SocialOAuthState = {
  actor: "admin";
  storeId: string;
  provider: SocialProvider;
  issuedAt: number;
  expiresAt: number;
};

const TTL_SECONDS = 10 * 60;

function b64(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function secret() {
  const value = process.env.SOCIAL_OAUTH_STATE_SECRET || process.env.ADMIN_SESSION_SECRET || "";
  if (!value) throw new Error("SOCIAL_OAUTH_STATE_SECRET or ADMIN_SESSION_SECRET is required");
  return value;
}

export function createSocialOAuthState(input: { storeId: string; provider: SocialProvider }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SocialOAuthState = {
    actor: "admin",
    ...input,
    issuedAt,
    expiresAt: issuedAt + TTL_SECONDS,
  };
  const encoded = b64(JSON.stringify(payload));
  const signature = createHmac("sha256", secret()).update(encoded).digest();
  return `${encoded}.${b64(signature)}`;
}

export function parseSocialOAuthState(value: string | null | undefined) {
  const [encoded, signatureText] = String(value || "").split(".");
  if (!encoded || !signatureText) throw new Error("Social OAuth state is missing or invalid");
  const expected = createHmac("sha256", secret()).update(encoded).digest();
  const supplied = Buffer.from(signatureText, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Social OAuth state signature mismatch");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SocialOAuthState;
  const now = Math.floor(Date.now() / 1000);
  if (payload.actor !== "admin" || !payload.storeId || !payload.provider || payload.expiresAt < now || payload.issuedAt > now + 60) {
    throw new Error("Social OAuth state is invalid or expired");
  }
  return payload;
}
