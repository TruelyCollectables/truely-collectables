import "server-only";

import { enforceBaseballPremiumPolicy } from "./market-intel-baseball-premium-enforcement";
import { syncMarketIntelGrowthAlertOutbox } from "./market-intel-growth-alerts";
import { syncMarketIntelAlertOutbox } from "./market-intel-reporting";

export async function syncAllMarketIntelAlerts() {
  await enforceBaseballPremiumPolicy();
  const standard = await syncMarketIntelAlertOutbox();
  const growth = await syncMarketIntelGrowthAlertOutbox();
  const policy = await enforceBaseballPremiumPolicy();

  return {
    qualified: standard.qualified + growth.qualified,
    created: standard.created + growth.created,
    refreshed: standard.refreshed + growth.refreshed,
    expired: standard.expired + growth.expired + policy.alertsExpired,
    reopened: growth.reopened,
    pending: [...standard.pending, ...growth.pending],
    standard,
    growth,
    baseballPremiumPolicy: policy,
  };
}
