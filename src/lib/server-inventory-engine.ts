import {
  InventoryEngine,
  InventoryRepository,
} from "../modules/inventory";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export function createServerInventoryEngine() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });

  return new InventoryEngine(
    storeId,
    new InventoryRepository(storeId, supabase),
    supabase,
  );
}
