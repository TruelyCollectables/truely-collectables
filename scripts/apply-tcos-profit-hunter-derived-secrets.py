from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_policy() -> None:
    path = ROOT / "src/lib/tcos-profit-hunter-policy.ts"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { timingSafeEqual } from "node:crypto";\n',
        'import { timingSafeEqual } from "node:crypto";\nimport { getProfitHunterConnectorToken } from "./tcos-profit-hunter-secrets";\n',
        "policy secret import",
    )
    text = replace_once(
        text,
        "expectedToken = process.env.TCOS_CONNECTOR_TOKEN,",
        "expectedToken = getProfitHunterConnectorToken(),",
        "policy default token",
    )
    path.write_text(text, encoding="utf-8")


def patch_job_server() -> None:
    path = ROOT / "src/lib/instacomp-job-server.ts"
    text = path.read_text(encoding="utf-8")
    import_anchor = 'import { createSupabaseServerClient } from "./supabase-server";\n'
    text = replace_once(
        text,
        import_anchor,
        import_anchor + 'import { getInstaCompServiceToken } from "./tcos-profit-hunter-secrets";\n',
        "job server secret import",
    )
    text = replace_once(
        text,
        "expectedToken = process.env.INSTACOMP_SERVICE_TOKEN,",
        "expectedToken = getInstaCompServiceToken(),",
        "job server default token",
    )
    path.write_text(text, encoding="utf-8")


def patch_connector_config() -> None:
    path = ROOT / "connectors/tcos-market-intel-mcp/src/config.mjs"
    text = path.read_text(encoding="utf-8")
    if 'import { createHmac } from "node:crypto";' not in text:
        text = 'import { createHmac } from "node:crypto";\n\n' + text

    anchor = '''const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
'''
    derived = anchor + '''
const derivedSecret = (explicitName, purpose) => {
  const explicit = String(process.env[explicitName] || "").trim();
  if (explicit) return explicit;
  const root = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (!root) return "";
  return createHmac("sha256", root)
    .update(`TCOS Profit Hunter ${purpose} v1`, "utf8")
    .digest("base64url");
};
'''
    text = replace_once(text, anchor, derived, "connector derived secret helper")
    text = replace_once(
        text,
        '  connectorToken: process.env.TCOS_CONNECTOR_TOKEN || "",',
        '  connectorToken: derivedSecret("TCOS_CONNECTOR_TOKEN", "connector bearer"),',
        "connector bearer fallback",
    )
    text = replace_once(
        text,
        '  instacompBaseUrl: String(process.env.INSTACOMP_BASE_URL || "").trim().replace(/\\/+$/, ""),',
        '  instacompBaseUrl: String(process.env.INSTACOMP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\\/+$/, ""),',
        "connector base URL fallback",
    )
    text = replace_once(
        text,
        '  instacompServiceToken: String(process.env.INSTACOMP_SERVICE_TOKEN || "").trim(),',
        '  instacompServiceToken: derivedSecret("INSTACOMP_SERVICE_TOKEN", "InstaComp service bearer"),',
        "connector service token fallback",
    )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_policy()
    patch_job_server()
    patch_connector_config()


if __name__ == "__main__":
    main()
