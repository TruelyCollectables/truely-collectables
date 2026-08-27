import { createHmac } from "node:crypto";

function explicitOrDerived(explicitName: string, purpose: string) {
  const explicit = String(process.env[explicitName] || "").trim();
  if (explicit) return explicit;

  const root = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (!root) return "";

  return createHmac("sha256", root)
    .update(`TCOS Profit Hunter ${purpose} v1`, "utf8")
    .digest("base64url");
}

export function getProfitHunterConnectorToken() {
  return explicitOrDerived("TCOS_CONNECTOR_TOKEN", "connector bearer");
}

export function getInstaCompServiceToken() {
  return explicitOrDerived("INSTACOMP_SERVICE_TOKEN", "InstaComp service bearer");
}

export function maskedSecret(value: string) {
  const secret = String(value || "");
  if (!secret) return null;
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}
