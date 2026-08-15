import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export type ShipStationOriginAddress = {
  name: string;
  company?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeShipStationOrigin(
  value: Partial<ShipStationOriginAddress> | null | undefined,
): ShipStationOriginAddress | null {
  if (!value) return null;
  const normalized: ShipStationOriginAddress = {
    name: clean(value.name),
    company: clean(value.company) || null,
    addressLine1: clean(value.addressLine1),
    addressLine2: clean(value.addressLine2) || null,
    city: clean(value.city),
    state: clean(value.state).toUpperCase(),
    postalCode: clean(value.postalCode),
    countryCode: clean(value.countryCode || "US").toUpperCase() || "US",
  };
  return shipStationOriginMissing(normalized).length ? null : normalized;
}

export function shipStationOriginMissing(
  value: Partial<ShipStationOriginAddress> | null | undefined,
) {
  const required: Record<string, unknown> = {
    name: value?.name,
    addressLine1: value?.addressLine1,
    city: value?.city,
    state: value?.state,
    postalCode: value?.postalCode,
    countryCode: value?.countryCode || "US",
  };
  return Object.entries(required)
    .filter(([, field]) => !clean(field))
    .map(([key]) => key);
}

function envOrigin() {
  return normalizeShipStationOrigin({
    name: process.env.TCOS_SHIP_FROM_NAME,
    company: process.env.TCOS_SHIP_FROM_COMPANY || "Truely Collectables",
    addressLine1: process.env.TCOS_SHIP_FROM_ADDRESS_LINE1,
    addressLine2: process.env.TCOS_SHIP_FROM_ADDRESS_LINE2,
    city: process.env.TCOS_SHIP_FROM_CITY,
    state: process.env.TCOS_SHIP_FROM_STATE,
    postalCode: process.env.TCOS_SHIP_FROM_POSTAL_CODE,
    countryCode: process.env.TCOS_SHIP_FROM_COUNTRY || "US",
  });
}

export async function getShipStationOrigin(): Promise<ShipStationOriginAddress | null> {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("store_settings")
    .select("metadata")
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) throw new Error(`Could not read ShipStation ship-from settings: ${error.message}`);
  const metadata =
    data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {};
  const stored = metadata.shipstation_ship_from;
  const storedOrigin =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? normalizeShipStationOrigin(stored as Partial<ShipStationOriginAddress>)
      : null;
  return storedOrigin || envOrigin();
}

export async function saveShipStationOrigin(
  value: Partial<ShipStationOriginAddress>,
): Promise<ShipStationOriginAddress> {
  const normalized = normalizeShipStationOrigin(value);
  if (!normalized) {
    throw new Error(`Ship-from address is incomplete: ${shipStationOriginMissing(value).join(", ")}.`);
  }
  if (normalized.countryCode !== "US") {
    throw new Error("TCOS ShipStation shipping is currently limited to US ship-from addresses.");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data, error: readError } = await supabase
    .from("store_settings")
    .select("metadata")
    .eq("store_id", storeId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read store settings: ${readError.message}`);

  const metadata =
    data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {};
  const { error } = await supabase.from("store_settings").upsert(
    {
      store_id: storeId,
      metadata: {
        ...metadata,
        shipstation_ship_from: normalized,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" },
  );
  if (error) throw new Error(`Could not save ShipStation ship-from settings: ${error.message}`);
  return normalized;
}
