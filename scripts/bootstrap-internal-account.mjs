import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_EMAIL = "Sales@truelycollectables.com";
const DEFAULT_DISPLAY_NAME = "Truely Collectables Sales";
const DEFAULT_STORE_ID = "00000000-0000-4000-8000-000000000001";
const TERMS_OF_SERVICE_VERSION = "2026-06-28";

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const text = readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] || "";

  return "";
}

function required(value, label) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

async function findUserByEmail(supabase, email) {
  const normalized = email.toLowerCase();
  let page = 1;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) throw error;

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === normalized,
    );

    if (user) return user;
    if (data.users.length < 100) return null;

    page += 1;
  }

  throw new Error("Supabase user list exceeded the safe 2,000-user bootstrap scan.");
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env.development.local");

  const supabaseUrl = required(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceRoleKey = required(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const email = (
    argValue("email") ||
    process.env.TCOS_BOOTSTRAP_ACCOUNT_EMAIL ||
    DEFAULT_EMAIL
  )
    .trim()
    .toLowerCase();
  const password = required(
    argValue("password") || process.env.TCOS_BOOTSTRAP_ACCOUNT_PASSWORD,
    "TCOS_BOOTSTRAP_ACCOUNT_PASSWORD or --password",
  );
  const displayName =
    argValue("display-name") ||
    process.env.TCOS_BOOTSTRAP_ACCOUNT_DISPLAY_NAME ||
    DEFAULT_DISPLAY_NAME;
  const storeId =
    argValue("store-id") ||
    process.env.TCOS_BOOTSTRAP_ACCOUNT_STORE_ID ||
    DEFAULT_STORE_ID;
  const now = new Date().toISOString();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const existingUser = await findUserByEmail(supabase, email);
  const userResult = existingUser
    ? await supabase.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser.user_metadata || {}),
          display_name: displayName,
          tcos_account_type: "seller",
          internal_bootstrap: true,
        },
      })
    : await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          tcos_account_type: "seller",
          internal_bootstrap: true,
        },
      });

  if (userResult.error || !userResult.data.user) {
    throw userResult.error || new Error("Supabase did not return a user.");
  }

  const user = userResult.data.user;

  const { error: profileError } = await supabase.from("account_profiles").upsert(
    {
      id: user.id,
      email,
      display_name: displayName,
      account_status: "active",
      default_account_type: "seller",
      tos_accepted: true,
      tos_version: TERMS_OF_SERVICE_VERSION,
      tos_accepted_at: now,
      card_verified: true,
      card_verified_at: now,
      card_verification_failure_reason: null,
      card_verification_checked_at: now,
      updated_at: now,
    },
    { onConflict: "id" },
  );

  if (profileError) throw profileError;

  for (const role of ["buyer", "seller"]) {
    const { error } = await supabase.from("account_store_memberships").upsert(
      {
        account_id: user.id,
        store_id: storeId,
        role,
        status: "active",
        updated_at: now,
      },
      { onConflict: "account_id,store_id,role" },
    );

    if (error) throw error;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        userId: user.id,
        accountStatus: "active",
        cardVerification: "bypassed_internal_bootstrap",
        roles: ["buyer", "seller"],
        passwordPrinted: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
