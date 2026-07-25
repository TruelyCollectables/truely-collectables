import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getActiveStoreId } from "../../lib/stores";
import { InventoryEngine } from "./engine";
import { InventoryRepository } from "./repository";

const storeId = getActiveStoreId();
const database = createSupabaseServerClient({ admin: true });
const repository = new InventoryRepository(storeId, database);

/**
 * Server inventory engine for trusted application routes and background syncs.
 *
 * The browser/public Supabase client remains protected by RLS. Server-side
 * inventory mutations use the service-role client so eBay imports and other
 * trusted workflows can write store-scoped product and inventory rows.
 */
export const adminInventoryEngine = new InventoryEngine(
  storeId,
  repository,
  database,
);
