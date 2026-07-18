import "server-only";

import { syncMarketIntelGrowthAlertOutbox } from "./market-intel-growth-alerts";
import { syncMarketIntelAlertOutbox } from "./market-intel-reporting";

export async function syncAllMarketIntelAlerts() {
  const standard = await syncMarketIntelAlertOutbox();
  const growth = await syncMarketIntelGrowthAlertOutbox();

  return {
    qualified: standard.qualified + growth.qualified,
    created: standard.created + growth.created,
    refreshed: standard.refreshed + growth.refreshed,
    expired: standard.expired + growth.expired,
    reopened: growth.reopened,
    pending: [...standard.pending, ...growth.pending],
    standard,
    growth,
  };
}
