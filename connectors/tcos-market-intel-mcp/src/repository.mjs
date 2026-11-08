import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config, persistenceConfigured } from "./config.mjs";
import {
  compareListingsForDuplicate,
  compactListing,
  fingerprintListing,
  identityKey,
  normalizeUrl,
  roundMoney,
} from "./logic.mjs";

const nowIso = () => new Date().toISOString();

class MemoryRepository {
  constructor() {
    this.savedSearches = new Map();
    this.listings = new Map();
    this.compSales = [];
    this.acquisitionLots = new Map();
    this.sales = new Map();
    this.auditEvents = [];
  }

  async status() {
    return { mode: "memory", persistent: false };
  }

  async listSavedSearches({ enabledOnly = false } = {}) {
    return [...this.savedSearches.values()]
      .filter((entry) => !enabledOnly || entry.enabled)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsertSavedSearch(input) {
    const id = input.id || randomUUID();
    const existing = this.savedSearches.get(id);
    const record = {
      id,
      name: input.name,
      query: input.query,
      sources: input.sources || [],
      filters: input.filters || {},
      enabled: input.enabled ?? true,
      cadence: input.cadence || null,
      lastRunAt: existing?.lastRunAt || null,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    this.savedSearches.set(id, record);
    await this.audit("saved_search.upsert", { id, name: record.name });
    return record;
  }

  async markSavedSearchRun(id) {
    const record = this.savedSearches.get(id);
    if (!record) return null;
    record.lastRunAt = nowIso();
    record.updatedAt = nowIso();
    return record;
  }

  async listListings(filters = {}) {
    const after = filters.discoveredAfter ? new Date(filters.discoveredAfter).getTime() : null;
    return [...this.listings.values()]
      .filter((listing) => !filters.source || listing.source === filters.source)
      .filter((listing) => !filters.status || listing.status === filters.status)
      .filter((listing) => !after || new Date(listing.discoveredAt).getTime() >= after)
      .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
      .slice(0, filters.limit || 100);
  }

  async findDuplicates(candidate) {
    const matches = [];
    for (const existing of this.listings.values()) {
      const comparison = compareListingsForDuplicate(candidate, existing);
      if (comparison.duplicate || comparison.score >= 45) {
        matches.push({ listing: compactListing(existing), ...comparison });
      }
    }
    return matches.sort((a, b) => b.score - a.score);
  }

  async ingestListing(input) {
    const candidate = {
      ...input,
      url: normalizeUrl(input.url),
      identityKey: identityKey(input.identity || {}),
      fingerprint: fingerprintListing(input),
      discoveredAt: input.discoveredAt || nowIso(),
    };
    const duplicates = await this.findDuplicates(candidate);
    const exactDuplicate = duplicates.find((match) => match.score >= 80);
    if (exactDuplicate && !input.allowDuplicate) {
      return { created: false, duplicateOf: exactDuplicate.listing, duplicateEvidence: exactDuplicate };
    }

    const id = input.id || randomUUID();
    const record = {
      id,
      ...candidate,
      status: input.status || "new",
      manualReviewRequired: Boolean(input.manualReviewRequired),
      sellerRisk: input.sellerRisk || "unknown",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.listings.set(id, record);
    await this.audit("listing.ingest", { id, source: record.source, url: record.url });
    return { created: true, listing: record, possibleDuplicates: duplicates };
  }

  async addCompSales(identity, sales, { listingId = null } = {}) {
    const key = identityKey(identity);
    const created = sales.map((sale) => ({
      id: randomUUID(),
      identityKey: key,
      identity,
      listingId,
      source: sale.source,
      soldAt: sale.soldAt,
      soldPrice: roundMoney(sale.soldPrice),
      shipping: roundMoney(sale.shipping || 0),
      totalPrice: roundMoney(sale.totalPrice ?? Number(sale.soldPrice) + Number(sale.shipping || 0)),
      url: normalizeUrl(sale.url),
      exactMatch: sale.exactMatch ?? true,
      rawOrGraded: sale.rawOrGraded || identity.rawOrGraded || null,
      grade: sale.grade || identity.grade || null,
      gradingCompany: sale.gradingCompany || identity.gradingCompany || null,
      createdAt: nowIso(),
    }));
    this.compSales.push(...created);
    await this.audit("comps.add", { identityKey: key, count: created.length });
    return created;
  }

  async getCompHistory(identity, { limit = 100 } = {}) {
    const key = identityKey(identity);
    return this.compSales
      .filter((sale) => sale.identityKey === key)
      .sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime())
      .slice(0, limit);
  }

  async recordPurchase(input) {
    const id = input.id || randomUUID();
    const record = {
      id,
      portfolioId: input.portfolioId || null,
      source: input.source,
      sourceUrl: normalizeUrl(input.sourceUrl),
      sourceItemId: input.sourceItemId || null,
      orderNumber: input.orderNumber || null,
      purchasedAt: input.purchasedAt || nowIso(),
      sellerName: input.sellerName || null,
      quantity: Number(input.quantity),
      deliveredCost: roundMoney(input.deliveredCost),
      exactUnitCost: Number(input.deliveredCost) / Math.max(1, Number(input.quantity)),
      status: input.status || "awaiting_receipt",
      items: input.items || [],
      notes: input.notes || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.acquisitionLots.set(id, record);
    await this.audit("purchase.record", { id, quantity: record.quantity, deliveredCost: record.deliveredCost });
    return record;
  }

  async markReceived(input) {
    const lot = this.acquisitionLots.get(input.lotId);
    if (!lot) throw new Error(`Acquisition lot ${input.lotId} was not found`);
    lot.status = "in_inventory";
    lot.receivedAt = input.receivedAt || nowIso();
    lot.receiptNotes = input.receiptNotes || null;
    if (input.verifiedItems) lot.items = input.verifiedItems;
    lot.updatedAt = nowIso();
    await this.audit("purchase.received", { id: lot.id, receivedAt: lot.receivedAt });
    return lot;
  }

  async recordSale(input) {
    const lot = this.acquisitionLots.get(input.lotId);
    if (!lot) throw new Error(`Acquisition lot ${input.lotId} was not found`);
    const id = input.id || randomUUID();
    const quantitySold = Number(input.quantitySold);
    const unitCost = lot.exactUnitCost;
    const assignedCostBasis = roundMoney(unitCost * quantitySold);
    const netProceeds = roundMoney(input.netProceeds);
    const record = {
      id,
      lotId: lot.id,
      soldAt: input.soldAt || nowIso(),
      marketplace: input.marketplace,
      quantitySold,
      grossSale: roundMoney(input.grossSale),
      buyerShipping: roundMoney(input.buyerShipping || 0),
      marketplaceFees: roundMoney(input.marketplaceFees || 0),
      paymentFees: roundMoney(input.paymentFees || 0),
      actualPostage: roundMoney(input.actualPostage || 0),
      supplies: roundMoney(input.supplies || 0),
      refunds: roundMoney(input.refunds || 0),
      netProceeds,
      assignedCostBasis,
      realizedProfit: roundMoney(netProceeds - assignedCostBasis),
      createdAt: nowIso(),
    };
    this.sales.set(id, record);
    const totalSold = [...this.sales.values()]
      .filter((sale) => sale.lotId === lot.id)
      .reduce((sum, sale) => sum + sale.quantitySold, 0);
    lot.remainingQuantity = Math.max(0, lot.quantity - totalSold);
    lot.remainingCostBasis = roundMoney(lot.remainingQuantity * lot.exactUnitCost);
    if (lot.remainingQuantity === 0) lot.status = "sold";
    lot.updatedAt = nowIso();
    await this.audit("sale.record", { id, lotId: lot.id, realizedProfit: record.realizedProfit });
    return { sale: record, lot };
  }

  async getPortfolioSummary() {
    const lots = [...this.acquisitionLots.values()];
    const sales = [...this.sales.values()];
    const totals = lots.reduce(
      (acc, lot) => {
        acc.purchaseLots += 1;
        acc.unitsPurchased += lot.quantity;
        acc.capitalDeployed += lot.deliveredCost;
        const remainingQuantity = lot.remainingQuantity ?? lot.quantity;
        const remainingBasis = lot.remainingCostBasis ?? lot.deliveredCost;
        acc.remainingUnits += remainingQuantity;
        acc.remainingCostBasis += remainingBasis;
        if (lot.status === "awaiting_receipt") acc.awaitingReceipt += remainingQuantity;
        if (lot.status === "in_inventory") acc.inInventory += remainingQuantity;
        if (lot.status === "returned") acc.returned += lot.quantity;
        if (lot.status === "canceled") acc.canceled += lot.quantity;
        return acc;
      },
      {
        purchaseLots: 0,
        unitsPurchased: 0,
        remainingUnits: 0,
        awaitingReceipt: 0,
        inInventory: 0,
        returned: 0,
        canceled: 0,
        capitalDeployed: 0,
        remainingCostBasis: 0,
      },
    );
    totals.unitsSold = sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
    totals.realizedGrossSales = roundMoney(sales.reduce((sum, sale) => sum + sale.grossSale, 0));
    totals.realizedNetProceeds = roundMoney(sales.reduce((sum, sale) => sum + sale.netProceeds, 0));
    totals.realizedProfit = roundMoney(sales.reduce((sum, sale) => sum + sale.realizedProfit, 0));
    totals.capitalDeployed = roundMoney(totals.capitalDeployed);
    totals.remainingCostBasis = roundMoney(totals.remainingCostBasis);
    return { totals, lots, sales };
  }

  async audit(action, payload) {
    this.auditEvents.push({ id: randomUUID(), action, payload, createdAt: nowIso() });
  }
}

class SupabaseRepository {
  constructor() {
    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async status() {
    const { error } = await this.client.from("tcos_saved_searches").select("id", { count: "exact", head: true });
    if (error) throw error;
    return { mode: "supabase", persistent: true };
  }

  async listSavedSearches({ enabledOnly = false } = {}) {
    let query = this.client.from("tcos_saved_searches").select("*").order("name");
    if (enabledOnly) query = query.eq("enabled", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapSavedSearch);
  }

  async upsertSavedSearch(input) {
    const row = {
      id: input.id || randomUUID(),
      name: input.name,
      query: input.query,
      sources: input.sources || [],
      filters: input.filters || {},
      enabled: input.enabled ?? true,
      cadence: input.cadence || null,
      updated_at: nowIso(),
    };
    const { data, error } = await this.client.from("tcos_saved_searches").upsert(row).select("*").single();
    if (error) throw error;
    await this.audit("saved_search.upsert", { id: data.id, name: data.name });
    return mapSavedSearch(data);
  }

  async markSavedSearchRun(id) {
    const { data, error } = await this.client
      .from("tcos_saved_searches")
      .update({ last_run_at: nowIso(), updated_at: nowIso() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapSavedSearch(data);
  }

  async listListings(filters = {}) {
    let query = this.client.from("tcos_listings").select("*").order("discovered_at", { ascending: false });
    if (filters.source) query = query.eq("source", filters.source);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.discoveredAfter) query = query.gte("discovered_at", filters.discoveredAfter);
    query = query.limit(filters.limit || 100);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapListing);
  }

  async findDuplicates(candidate) {
    const normalizedUrl = normalizeUrl(candidate.url);
    const fingerprint = fingerprintListing(candidate);
    const cert = candidate.certificationNumber || null;
    const clauses = [`fingerprint.eq.${fingerprint}`];
    if (normalizedUrl) clauses.push(`normalized_url.eq.${normalizedUrl}`);
    if (cert) clauses.push(`certification_number.eq.${cert}`);
    const { data, error } = await this.client.from("tcos_listings").select("*").or(clauses.join(",")).limit(25);
    if (error) throw error;
    const direct = (data || []).map(mapListing);

    if (direct.length < 25 && candidate.identity) {
      const key = identityKey(candidate.identity);
      const { data: similar, error: similarError } = await this.client
        .from("tcos_listings")
        .select("*")
        .eq("identity_key", key)
        .order("discovered_at", { ascending: false })
        .limit(50);
      if (similarError) throw similarError;
      for (const row of similar || []) {
        if (!direct.some((entry) => entry.id === row.id)) direct.push(mapListing(row));
      }
    }

    return direct
      .map((listing) => ({ listing: compactListing(listing), ...compareListingsForDuplicate(candidate, listing) }))
      .filter((match) => match.duplicate || match.score >= 45)
      .sort((a, b) => b.score - a.score);
  }

  async ingestListing(input) {
    const candidate = {
      ...input,
      url: normalizeUrl(input.url),
      discoveredAt: input.discoveredAt || nowIso(),
    };
    const duplicates = await this.findDuplicates(candidate);
    const exactDuplicate = duplicates.find((match) => match.score >= 80);
    if (exactDuplicate && !input.allowDuplicate) {
      return { created: false, duplicateOf: exactDuplicate.listing, duplicateEvidence: exactDuplicate };
    }

    const row = {
      id: input.id || randomUUID(),
      source: input.source,
      url: input.url,
      normalized_url: candidate.url,
      discovered_at: candidate.discoveredAt,
      seller_name: input.sellerName || null,
      seller_account_url: input.sellerAccountUrl || null,
      location: input.location || null,
      title: input.title,
      description: input.description || null,
      asking_price: input.askingPrice ?? null,
      shipping: input.shipping ?? null,
      buyer_fees: input.buyerFees ?? null,
      tax: input.tax ?? null,
      quantity: input.quantity ?? null,
      pickup_or_shipping: input.pickupOrShipping || null,
      payment_method: input.paymentMethod || null,
      negotiable: input.negotiable ?? null,
      identity: input.identity || {},
      identity_key: identityKey(input.identity || {}),
      certification_number: input.certificationNumber || input.identity?.certificationNumber || null,
      photo_hashes: input.photoHashes || [],
      image_urls: input.imageUrls || [],
      status: input.status || "new",
      manual_review_required: Boolean(input.manualReviewRequired),
      seller_risk: input.sellerRisk || "unknown",
      fingerprint: fingerprintListing(candidate),
      raw_payload: input.rawPayload || {},
      updated_at: nowIso(),
    };
    const { data, error } = await this.client.from("tcos_listings").insert(row).select("*").single();
    if (error) throw error;
    await this.audit("listing.ingest", { id: data.id, source: data.source, url: data.normalized_url });
    return { created: true, listing: mapListing(data), possibleDuplicates: duplicates };
  }

  async addCompSales(identity, sales, { listingId = null } = {}) {
    const key = identityKey(identity);
    const rows = sales.map((sale) => ({
      id: randomUUID(),
      identity_key: key,
      identity,
      listing_id: listingId,
      source: sale.source,
      sold_at: sale.soldAt,
      sold_price: roundMoney(sale.soldPrice),
      shipping: roundMoney(sale.shipping || 0),
      total_price: roundMoney(sale.totalPrice ?? Number(sale.soldPrice) + Number(sale.shipping || 0)),
      url: normalizeUrl(sale.url),
      exact_match: sale.exactMatch ?? true,
      raw_or_graded: sale.rawOrGraded || identity.rawOrGraded || null,
      grade: sale.grade || identity.grade || null,
      grading_company: sale.gradingCompany || identity.gradingCompany || null,
    }));
    const { data, error } = await this.client.from("tcos_comp_sales").insert(rows).select("*");
    if (error) throw error;
    await this.audit("comps.add", { identityKey: key, count: rows.length });
    return data || [];
  }

  async getCompHistory(identity, { limit = 100 } = {}) {
    const { data, error } = await this.client
      .from("tcos_comp_sales")
      .select("*")
      .eq("identity_key", identityKey(identity))
      .order("sold_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      identityKey: row.identity_key,
      identity: row.identity,
      listingId: row.listing_id,
      source: row.source,
      soldAt: row.sold_at,
      soldPrice: Number(row.sold_price),
      shipping: Number(row.shipping || 0),
      totalPrice: Number(row.total_price),
      url: row.url,
      exactMatch: row.exact_match,
      rawOrGraded: row.raw_or_graded,
      grade: row.grade,
      gradingCompany: row.grading_company,
    }));
  }

  async recordPurchase(input) {
    const row = {
      id: input.id || randomUUID(),
      portfolio_id: input.portfolioId || null,
      source: input.source,
      source_url: normalizeUrl(input.sourceUrl),
      source_item_id: input.sourceItemId || null,
      order_number: input.orderNumber || null,
      purchased_at: input.purchasedAt || nowIso(),
      seller_name: input.sellerName || null,
      quantity: Number(input.quantity),
      delivered_cost: roundMoney(input.deliveredCost),
      exact_unit_cost: Number(input.deliveredCost) / Math.max(1, Number(input.quantity)),
      status: input.status || "awaiting_receipt",
      notes: input.notes || null,
      updated_at: nowIso(),
    };
    const { data, error } = await this.client.from("tcos_acquisition_lots").insert(row).select("*").single();
    if (error) throw error;
    if (Array.isArray(input.items) && input.items.length) {
      const itemRows = input.items.map((item) => ({
        id: randomUUID(),
        lot_id: data.id,
        identity: item.identity || {},
        identity_key: identityKey(item.identity || {}),
        quantity: Number(item.quantity || 1),
        allocated_cost: item.allocatedCost ?? null,
        status: item.status || row.status,
        notes: item.notes || null,
      }));
      const { error: itemError } = await this.client.from("tcos_acquisition_items").insert(itemRows);
      if (itemError) throw itemError;
    }
    await this.audit("purchase.record", { id: data.id, quantity: data.quantity, deliveredCost: data.delivered_cost });
    return mapLot(data, input.items || []);
  }

  async markReceived(input) {
    const receivedAt = input.receivedAt || nowIso();
    const { data, error } = await this.client
      .from("tcos_acquisition_lots")
      .update({ status: "in_inventory", received_at: receivedAt, receipt_notes: input.receiptNotes || null, updated_at: nowIso() })
      .eq("id", input.lotId)
      .select("*")
      .single();
    if (error) throw error;
    if (Array.isArray(input.verifiedItems) && input.verifiedItems.length) {
      await this.client.from("tcos_acquisition_items").delete().eq("lot_id", input.lotId);
      const rows = input.verifiedItems.map((item) => ({
        id: randomUUID(),
        lot_id: input.lotId,
        identity: item.identity || {},
        identity_key: identityKey(item.identity || {}),
        quantity: Number(item.quantity || 1),
        allocated_cost: item.allocatedCost ?? null,
        status: "in_inventory",
        notes: item.notes || null,
      }));
      const { error: itemError } = await this.client.from("tcos_acquisition_items").insert(rows);
      if (itemError) throw itemError;
    }
    await this.audit("purchase.received", { id: input.lotId, receivedAt });
    return mapLot(data, input.verifiedItems || []);
  }

  async recordSale(input) {
    const { data: lot, error: lotError } = await this.client
      .from("tcos_acquisition_lots")
      .select("*")
      .eq("id", input.lotId)
      .single();
    if (lotError) throw lotError;
    const quantitySold = Number(input.quantitySold);
    const assignedCostBasis = roundMoney(Number(lot.exact_unit_cost) * quantitySold);
    const netProceeds = roundMoney(input.netProceeds);
    const saleRow = {
      id: input.id || randomUUID(),
      lot_id: input.lotId,
      sold_at: input.soldAt || nowIso(),
      marketplace: input.marketplace,
      quantity_sold: quantitySold,
      gross_sale: roundMoney(input.grossSale),
      buyer_shipping: roundMoney(input.buyerShipping || 0),
      marketplace_fees: roundMoney(input.marketplaceFees || 0),
      payment_fees: roundMoney(input.paymentFees || 0),
      actual_postage: roundMoney(input.actualPostage || 0),
      supplies: roundMoney(input.supplies || 0),
      refunds: roundMoney(input.refunds || 0),
      net_proceeds: netProceeds,
      assigned_cost_basis: assignedCostBasis,
      realized_profit: roundMoney(netProceeds - assignedCostBasis),
    };
    const { data: sale, error: saleError } = await this.client.from("tcos_sales").insert(saleRow).select("*").single();
    if (saleError) throw saleError;

    const { data: soldRows, error: soldError } = await this.client
      .from("tcos_sales")
      .select("quantity_sold")
      .eq("lot_id", input.lotId);
    if (soldError) throw soldError;
    const totalSold = (soldRows || []).reduce((sum, row) => sum + Number(row.quantity_sold), 0);
    const remainingQuantity = Math.max(0, Number(lot.quantity) - totalSold);
    const remainingCostBasis = roundMoney(remainingQuantity * Number(lot.exact_unit_cost));
    const { data: updatedLot, error: updateError } = await this.client
      .from("tcos_acquisition_lots")
      .update({
        remaining_quantity: remainingQuantity,
        remaining_cost_basis: remainingCostBasis,
        status: remainingQuantity === 0 ? "sold" : lot.status,
        updated_at: nowIso(),
      })
      .eq("id", input.lotId)
      .select("*")
      .single();
    if (updateError) throw updateError;
    await this.audit("sale.record", { id: sale.id, lotId: input.lotId, realizedProfit: sale.realized_profit });
    return { sale, lot: mapLot(updatedLot, []) };
  }

  async getPortfolioSummary() {
    const [{ data: lots, error: lotError }, { data: sales, error: salesError }] = await Promise.all([
      this.client.from("tcos_acquisition_lots").select("*").order("purchased_at"),
      this.client.from("tcos_sales").select("*").order("sold_at"),
    ]);
    if (lotError) throw lotError;
    if (salesError) throw salesError;
    const mappedLots = (lots || []).map((lot) => mapLot(lot, []));
    const mappedSales = sales || [];
    const totals = mappedLots.reduce(
      (acc, lot) => {
        acc.purchaseLots += 1;
        acc.unitsPurchased += lot.quantity;
        acc.capitalDeployed += lot.deliveredCost;
        const remainingQuantity = lot.remainingQuantity ?? lot.quantity;
        const remainingBasis = lot.remainingCostBasis ?? lot.deliveredCost;
        acc.remainingUnits += remainingQuantity;
        acc.remainingCostBasis += remainingBasis;
        if (lot.status === "awaiting_receipt") acc.awaitingReceipt += remainingQuantity;
        if (lot.status === "in_inventory") acc.inInventory += remainingQuantity;
        if (lot.status === "returned") acc.returned += lot.quantity;
        if (lot.status === "canceled") acc.canceled += lot.quantity;
        return acc;
      },
      {
        purchaseLots: 0,
        unitsPurchased: 0,
        remainingUnits: 0,
        awaitingReceipt: 0,
        inInventory: 0,
        returned: 0,
        canceled: 0,
        capitalDeployed: 0,
        remainingCostBasis: 0,
      },
    );
    totals.unitsSold = mappedSales.reduce((sum, sale) => sum + Number(sale.quantity_sold), 0);
    totals.realizedGrossSales = roundMoney(mappedSales.reduce((sum, sale) => sum + Number(sale.gross_sale), 0));
    totals.realizedNetProceeds = roundMoney(mappedSales.reduce((sum, sale) => sum + Number(sale.net_proceeds), 0));
    totals.realizedProfit = roundMoney(mappedSales.reduce((sum, sale) => sum + Number(sale.realized_profit), 0));
    totals.capitalDeployed = roundMoney(totals.capitalDeployed);
    totals.remainingCostBasis = roundMoney(totals.remainingCostBasis);
    return { totals, lots: mappedLots, sales: mappedSales };
  }

  async audit(action, payload) {
    const { error } = await this.client.from("tcos_connector_audit_log").insert({ action, payload });
    if (error) console.error("Audit write failed", error.message);
  }
}

const mapSavedSearch = (row) => ({
  id: row.id,
  name: row.name,
  query: row.query,
  sources: row.sources || [],
  filters: row.filters || {},
  enabled: row.enabled,
  cadence: row.cadence,
  lastRunAt: row.last_run_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapListing = (row) => ({
  id: row.id,
  source: row.source,
  url: row.normalized_url || row.url,
  originalUrl: row.url,
  discoveredAt: row.discovered_at,
  sellerName: row.seller_name,
  sellerAccountUrl: row.seller_account_url,
  location: row.location,
  title: row.title,
  description: row.description,
  askingPrice: row.asking_price == null ? null : Number(row.asking_price),
  shipping: row.shipping == null ? null : Number(row.shipping),
  buyerFees: row.buyer_fees == null ? null : Number(row.buyer_fees),
  tax: row.tax == null ? null : Number(row.tax),
  quantity: row.quantity,
  pickupOrShipping: row.pickup_or_shipping,
  paymentMethod: row.payment_method,
  negotiable: row.negotiable,
  identity: row.identity || {},
  identityKey: row.identity_key,
  certificationNumber: row.certification_number,
  photoHashes: row.photo_hashes || [],
  imageUrls: row.image_urls || [],
  status: row.status,
  manualReviewRequired: row.manual_review_required,
  sellerRisk: row.seller_risk,
  fingerprint: row.fingerprint,
  rawPayload: row.raw_payload || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapLot = (row, items) => ({
  id: row.id,
  portfolioId: row.portfolio_id,
  source: row.source,
  sourceUrl: row.source_url,
  sourceItemId: row.source_item_id,
  orderNumber: row.order_number,
  purchasedAt: row.purchased_at,
  receivedAt: row.received_at,
  sellerName: row.seller_name,
  quantity: Number(row.quantity),
  remainingQuantity: row.remaining_quantity == null ? Number(row.quantity) : Number(row.remaining_quantity),
  deliveredCost: Number(row.delivered_cost),
  exactUnitCost: Number(row.exact_unit_cost),
  remainingCostBasis: row.remaining_cost_basis == null ? Number(row.delivered_cost) : Number(row.remaining_cost_basis),
  status: row.status,
  notes: row.notes,
  receiptNotes: row.receipt_notes,
  items,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createRepository = () => (persistenceConfigured ? new SupabaseRepository() : new MemoryRepository());
