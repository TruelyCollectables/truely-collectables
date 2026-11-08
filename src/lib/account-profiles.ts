import { supabase } from "./supabase";

export type AccountProfileSummary = {
  id: string;
  email: string | null;
  display_name: string | null;
  account_status: string | null;
  default_account_type: string | null;
};

function uniqueAccountIds(accountIds: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      accountIds
        .map((accountId) => String(accountId || "").trim())
        .filter((accountId) => accountId.length > 0),
    ),
  );
}

function isMissingAccountProfilesError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.toLowerCase().includes("account_profiles") === true
  );
}

export async function getAccountProfilesByIds(
  accountIds: Array<string | null | undefined>,
) {
  const ids = uniqueAccountIds(accountIds);
  const profilesById = new Map<string, AccountProfileSummary>();

  if (ids.length === 0) return profilesById;

  const { data, error } = await supabase
    .from("account_profiles")
    .select("id,email,display_name,account_status,default_account_type")
    .in("id", ids);

  if (error) {
    if (isMissingAccountProfilesError(error)) return profilesById;
    throw error;
  }

  for (const profile of (data || []) as AccountProfileSummary[]) {
    profilesById.set(profile.id, profile);
  }

  return profilesById;
}
