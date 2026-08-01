import { createClient } from "@supabase/supabase-js";

function argumentValues(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Checklist identity repair requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const releaseIds = argumentValues("--release-id");
  for (const releaseId of releaseIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(releaseId)) {
      throw new Error(`Invalid --release-id UUID: ${releaseId}`);
    }
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc(
    "tcos_repair_active_checklist_identities",
    {
      p_release_ids: releaseIds.length ? releaseIds : null,
    },
  );

  if (error) {
    throw new Error(`Checklist identity repair failed: ${error.message}`);
  }

  const receipt = data as {
    schema?: string;
    ok?: boolean;
    activeVersions?: number;
    expectedIdentities?: number;
    beforeIdentities?: number;
    insertedIdentities?: number;
    afterIdentities?: number;
    unresolvedVersions?: unknown[];
  };

  console.log(JSON.stringify(receipt, null, 2));

  if (receipt.ok !== true || (receipt.unresolvedVersions || []).length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
