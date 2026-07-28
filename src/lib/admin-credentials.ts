import "server-only";

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";
import { getActiveStoreId } from "./stores";

const ADMIN_AUTH_METADATA_KEY = "admin_auth_v1";
const RESET_TTL_MINUTES = 30;
const RESET_REQUEST_COOLDOWN_SECONDS = 90;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 200;

type AdminCredentialRecord = {
  version: 1;
  algorithm: "scrypt-v1";
  passwordHash: string | null;
  passwordSalt: string | null;
  passwordUpdatedAt: string | null;
  recoveryEmail: string;
  resetTokenHash: string | null;
  resetExpiresAt: string | null;
  resetRequestedAt: string | null;
};

type StoreSettingsRecord = {
  store_id: string;
  metadata: Record<string, unknown> | null;
};

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return email.includes("@") && email.length <= 320 ? email : null;
}

function recoveryEmail() {
  return (
    normalizeEmail(process.env.ADMIN_RECOVERY_EMAIL) ||
    normalizeEmail(process.env.SALES_EMAIL) ||
    "sales@truelycollectables.com"
  );
}

function emptyRecord(): AdminCredentialRecord {
  return {
    version: 1,
    algorithm: "scrypt-v1",
    passwordHash: null,
    passwordSalt: null,
    passwordUpdatedAt: null,
    recoveryEmail: recoveryEmail(),
    resetTokenHash: null,
    resetExpiresAt: null,
    resetRequestedAt: null,
  };
}

function normalizeRecord(value: unknown): AdminCredentialRecord {
  if (!value || typeof value !== "object") return emptyRecord();
  const input = value as Record<string, unknown>;
  return {
    version: 1,
    algorithm: "scrypt-v1",
    passwordHash:
      typeof input.passwordHash === "string" && input.passwordHash
        ? input.passwordHash
        : null,
    passwordSalt:
      typeof input.passwordSalt === "string" && input.passwordSalt
        ? input.passwordSalt
        : null,
    passwordUpdatedAt:
      typeof input.passwordUpdatedAt === "string" ? input.passwordUpdatedAt : null,
    recoveryEmail: normalizeEmail(input.recoveryEmail) || recoveryEmail(),
    resetTokenHash:
      typeof input.resetTokenHash === "string" && input.resetTokenHash
        ? input.resetTokenHash
        : null,
    resetExpiresAt:
      typeof input.resetExpiresAt === "string" ? input.resetExpiresAt : null,
    resetRequestedAt:
      typeof input.resetRequestedAt === "string" ? input.resetRequestedAt : null,
  };
}

async function readStoreSettings() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("store_settings")
    .select("store_id,metadata")
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Admin credential storage is unavailable: ${error.message}`);
  }

  const row = (data || null) as StoreSettingsRecord | null;
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    supabase,
    storeId,
    row,
    metadata: { ...metadata },
    credential: normalizeRecord(metadata[ADMIN_AUTH_METADATA_KEY]),
  };
}

async function writeCredential(
  credential: AdminCredentialRecord,
  prior?: Awaited<ReturnType<typeof readStoreSettings>>,
) {
  const state = prior || (await readStoreSettings());
  const metadata = {
    ...state.metadata,
    [ADMIN_AUTH_METADATA_KEY]: credential,
  };

  // The Production store_settings contract owns its timestamp behavior. Write
  // only the existing metadata column; injecting an assumed updated_at column
  // caused the recovery flow to fail closed with storage_error.
  if (state.row) {
    const { error } = await state.supabase
      .from("store_settings")
      .update({ metadata })
      .eq("store_id", state.storeId);
    if (error) {
      throw new Error(`Admin credential could not be saved: ${error.message}`);
    }
    return;
  }

  const { error } = await state.supabase.from("store_settings").upsert(
    {
      store_id: state.storeId,
      metadata,
    },
    { onConflict: "store_id" },
  );
  if (error) {
    throw new Error(`Admin credential could not be created: ${error.message}`);
  }
}

function passwordDigest(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("base64url");
}

function safeStringEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function validateAdminPasswordPolicy(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must contain no more than ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export async function getDatabaseAdminCredentialStatus() {
  try {
    const state = await readStoreSettings();
    return {
      available: true,
      configured: Boolean(
        state.credential.passwordHash && state.credential.passwordSalt,
      ),
      recoveryEmail: state.credential.recoveryEmail,
      passwordUpdatedAt: state.credential.passwordUpdatedAt,
    };
  } catch (error) {
    return {
      available: false,
      configured: false,
      recoveryEmail: recoveryEmail(),
      passwordUpdatedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifyDatabaseAdminPasswordCandidates(
  candidates: string[],
) {
  const state = await readStoreSettings();
  const { credential } = state;
  const configured = Boolean(
    credential.passwordHash && credential.passwordSalt,
  );
  if (!configured) return { configured: false, valid: false };

  const valid = candidates.some((candidate) => {
    const digest = passwordDigest(candidate, credential.passwordSalt!);
    return safeStringEqual(digest, credential.passwordHash!);
  });
  return { configured: true, valid };
}

export async function setDatabaseAdminPassword(password: string) {
  const policyError = validateAdminPasswordPolicy(password);
  if (policyError) throw new Error(policyError);

  const state = await readStoreSettings();
  const salt = randomBytes(24).toString("base64url");
  const credential: AdminCredentialRecord = {
    ...state.credential,
    version: 1,
    algorithm: "scrypt-v1",
    passwordSalt: salt,
    passwordHash: passwordDigest(password, salt),
    passwordUpdatedAt: new Date().toISOString(),
    recoveryEmail: state.credential.recoveryEmail || recoveryEmail(),
    resetTokenHash: null,
    resetExpiresAt: null,
    resetRequestedAt: null,
  };
  await writeCredential(credential, state);
}

export async function createAdminPasswordReset() {
  const state = await readStoreSettings();
  const lastRequested = state.credential.resetRequestedAt
    ? Date.parse(state.credential.resetRequestedAt)
    : 0;
  const cooldownMs = RESET_REQUEST_COOLDOWN_SECONDS * 1000;
  if (lastRequested && Date.now() - lastRequested < cooldownMs) {
    return {
      email: state.credential.recoveryEmail,
      token: null,
      suppressed: true,
    };
  }

  const token = randomBytes(40).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + RESET_TTL_MINUTES * 60 * 1000);
  const credential: AdminCredentialRecord = {
    ...state.credential,
    recoveryEmail: state.credential.recoveryEmail || recoveryEmail(),
    resetTokenHash: tokenDigest(token),
    resetExpiresAt: expires.toISOString(),
    resetRequestedAt: now.toISOString(),
  };
  await writeCredential(credential, state);
  return {
    email: credential.recoveryEmail,
    token,
    suppressed: false,
  };
}

export async function consumeAdminPasswordReset(
  token: string,
  password: string,
) {
  const policyError = validateAdminPasswordPolicy(password);
  if (policyError) return { ok: false, reason: policyError };

  const state = await readStoreSettings();
  const expected = state.credential.resetTokenHash;
  const expiresAt = state.credential.resetExpiresAt
    ? Date.parse(state.credential.resetExpiresAt)
    : 0;
  const provided = tokenDigest(token);

  if (
    !expected ||
    !expiresAt ||
    expiresAt < Date.now() ||
    !safeStringEqual(provided, expected)
  ) {
    return {
      ok: false,
      reason: "This password-reset link is invalid or expired.",
    };
  }

  await setDatabaseAdminPassword(password);
  return { ok: true, reason: null };
}
