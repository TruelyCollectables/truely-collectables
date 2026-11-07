import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "./config.mjs";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const isPrivateIpv4 = (address) => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isPrivateIpv6 = (address) => {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
};

const isPrivateAddress = (address) => {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
};

export async function assertSafePublicImageUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("InstaComp image URLs must use HTTPS.");
  if (url.username || url.password) throw new Error("Image URLs may not contain credentials.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("Local image hosts are not allowed.");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Image host resolved to a private or unsafe network address.");
  }
  return url;
}

export function classifyProfitHunterOutcome({
  trustedResalePrice,
  pricingEligibleSoldCount,
  netProfit,
  roiPercent,
  manualReviewRequired = false,
  sellerRisk = "unknown",
}) {
  if (!(Number(trustedResalePrice) > 0) || Number(pricingEligibleSoldCount) < 1) {
    return {
      label: "SUPPRESSED — NO TRUSTED EXACT SOLD PRICE",
      purchaseReady: false,
      reason: "Hardened InstaComp did not return pricing-eligible exact sold evidence.",
    };
  }

  if (manualReviewRequired || sellerRisk === "high") {
    return {
      label: "TOO GOOD TO BE TRUE",
      purchaseReady: false,
      reason: "Identity, seller, condition, or fraud review remains unresolved.",
    };
  }

  if (Number(roiPercent) >= 50) {
    return {
      label: "TOO GOOD TO BE TRUE",
      purchaseReady: false,
      reason: "The verified spread is unusually large and requires a final fraud and condition check.",
    };
  }

  if (Number(roiPercent) >= 30 && Number(netProfit) >= 15) {
    return {
      label: "MUST BUY",
      purchaseReady: true,
      reason: "Exact sold-backed economics clear both the 30% ROI and $15 net-profit gates.",
    };
  }

  if (Number(roiPercent) >= 20) {
    return {
      label: "BORDERLINE BUY",
      purchaseReady: true,
      reason: "Exact sold-backed economics clear the 20% minimum ROI gate.",
    };
  }

  return {
    label: "NO FUCKING WAY / OVERPRICED",
    purchaseReady: false,
    reason: "Projected net ROI is below 20% after acquisition and resale costs.",
  };
}

const extensionForType = (contentType) => {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
};

async function downloadImage(input, label) {
  const url = await assertSafePublicImageUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.instacompTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "image/jpeg,image/png,image/webp",
        "User-Agent": "TCOS-Profit-Hunter-InstaComp/1.0",
      },
    });
    if (!response.ok) throw new Error(`${label} image download failed with HTTP ${response.status}.`);
    const contentType = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new Error(`${label} image must be JPEG, PNG, or WebP.`);
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error(`${label} image is larger than 12MB.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error(`${label} image download was empty.`);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${label} image is larger than 12MB.`);
    return new File([bytes], `${label.toLowerCase()}.${extensionForType(contentType)}`, {
      type: contentType,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const endpointUrl = () => new URL("/api/instacomp/live-scan", config.instacompBaseUrl).toString();

export const instaCompBridgeConfigured = Boolean(
  config.instacompBaseUrl && config.instacompServiceToken,
);

export const hardenedInstaCompService = Object.freeze({
  status() {
    return {
      configured: instaCompBridgeConfigured,
      baseUrlConfigured: Boolean(config.instacompBaseUrl),
      serviceTokenConfigured: Boolean(config.instacompServiceToken),
      endpoint: config.instacompBaseUrl ? endpointUrl() : null,
    };
  },

  async scanListing({
    frontImageUrl,
    backImageUrl,
    aiCouncilTier = "adaptive",
    operatorSerialNumberOverride,
  }) {
    if (!instaCompBridgeConfigured) {
      throw new Error(
        "Hardened InstaComp is not configured. Set INSTACOMP_BASE_URL and INSTACOMP_SERVICE_TOKEN.",
      );
    }

    const [frontImage, backImage] = await Promise.all([
      downloadImage(frontImageUrl, "Front"),
      downloadImage(backImageUrl, "Back"),
    ]);

    const form = new FormData();
    form.set("frontImage", frontImage);
    form.set("backImage", backImage);
    form.set("aiCouncilTier", aiCouncilTier);
    if (operatorSerialNumberOverride !== undefined) {
      form.set("operatorSerialNumberOverride", operatorSerialNumberOverride ?? "");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.instacompTimeoutMs);
    try {
      const response = await fetch(endpointUrl(), {
        method: "POST",
        headers: {
          "x-tcos-instacomp-service-token": config.instacompServiceToken,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
        redirect: "error",
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Hardened InstaComp returned unreadable JSON (HTTP ${response.status}).`);
      }
      if (!response.ok || payload?.ok !== true) {
        const message = payload?.error || payload?.note || `HTTP ${response.status}`;
        throw new Error(`Hardened InstaComp rejected the candidate: ${message}`);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  },
});
