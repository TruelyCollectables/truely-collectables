import {
  createCipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CONFIRMATION = "truely-cloudflare-cutover-v1";
const MAX_NAMES = 200;

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAllowedName(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  if (name === "TCOS_CF_SECRET_EXPORT_KEY") return false;

  const blockedPrefixes = [
    "VERCEL_",
    "AWS_",
    "GITHUB_",
    "ACTIONS_",
    "CI_",
    "RUNNER_",
  ];
  if (blockedPrefixes.some((prefix) => name.startsWith(prefix))) return false;

  const blockedExact = new Set([
    "PATH",
    "HOME",
    "PWD",
    "OLDPWD",
    "SHELL",
    "USER",
    "LOGNAME",
    "HOSTNAME",
    "NODE_ENV",
    "NODE_VERSION",
    "NPM_CONFIG_PREFIX",
    "NPM_CONFIG_USERCONFIG",
  ]);
  return !blockedExact.has(name);
}

export async function POST(request: Request) {
  // This route is intentionally inert outside a staged Vercel Production
  // deployment created for the one-time cutover secret handoff.
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "Not found" }, 404);
  }

  const exportKey = String(process.env.TCOS_CF_SECRET_EXPORT_KEY || "").trim();
  if (exportKey.length < 32) {
    return json({ ok: false, error: "Secret export is disabled" }, 404);
  }

  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const confirmation = request.headers.get("x-tcos-secret-export-confirm") || "";

  if (
    !supplied ||
    !secureEqual(exportKey, supplied) ||
    !secureEqual(CONFIRMATION, confirmation)
  ) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => null)) as
    | { names?: unknown }
    | null;
  const requested = Array.isArray(body?.names) ? body.names : [];
  const names = Array.from(
    new Set(
      requested
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .filter(isAllowedName),
    ),
  ).slice(0, MAX_NAMES);

  if (names.length === 0) {
    return json({ ok: false, error: "No export names supplied" }, 400);
  }

  const values: Record<string, string> = {};
  const unavailableNames: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) {
      values[name] = value;
    } else {
      unavailableNames.push(name);
    }
  }

  const plaintext = Buffer.from(
    JSON.stringify({
      version: 1,
      values,
    }),
    "utf8",
  );
  const key = createHash("sha256").update(exportKey, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return json({
    ok: true,
    version: 1,
    algorithm: "aes-256-gcm",
    count: Object.keys(values).length,
    exportedNames: Object.keys(values).sort(),
    unavailableNames: unavailableNames.sort(),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}
