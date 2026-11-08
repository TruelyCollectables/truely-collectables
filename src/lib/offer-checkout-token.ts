import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

type OfferCheckoutTokenPayload = {
  offerId: number;
  storeId: string;
  expiresAt: number;
};

function secret() {
  const value =
    process.env.OFFER_CHECKOUT_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 24) {
    throw new Error(
      "OFFER_CHECKOUT_SECRET or ADMIN_SESSION_SECRET must be configured for signed offer checkout links.",
    );
  }
  return value;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(encodedPayload: string) {
  return crypto
    .createHmac("sha256", secret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createOfferCheckoutToken(params: {
  offerId: number;
  storeId: string;
  now?: Date;
}) {
  const now = params.now || new Date();
  const payload: OfferCheckoutTokenPayload = {
    offerId: params.offerId,
    storeId: params.storeId,
    expiresAt: Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function parseOfferCheckoutToken(params: {
  token: string;
  storeId: string;
  offerId: number;
  now?: Date;
}) {
  const [encodedPayload, providedSignature, extra] = params.token.split(".");
  if (!encodedPayload || !providedSignature || extra) {
    throw new Error("Offer checkout link is invalid.");
  }

  const expectedSignature = signature(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Offer checkout link is invalid.");
  }

  let payload: OfferCheckoutTokenPayload;
  try {
    payload = JSON.parse(decode(encodedPayload)) as OfferCheckoutTokenPayload;
  } catch {
    throw new Error("Offer checkout link is invalid.");
  }

  const nowSeconds = Math.floor((params.now || new Date()).getTime() / 1000);
  if (
    payload.storeId !== params.storeId ||
    payload.offerId !== params.offerId ||
    payload.expiresAt < nowSeconds
  ) {
    throw new Error("Offer checkout link is invalid or expired.");
  }

  return payload;
}
