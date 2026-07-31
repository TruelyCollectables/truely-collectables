import {
  DUAL_MARKETPLACE_ROUTE_MAX_DURATION,
  handleDualMarketplaceGet,
  handleDualMarketplacePost,
} from "../../../../lib/dual-marketplace-admin-route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = DUAL_MARKETPLACE_ROUTE_MAX_DURATION;

export const GET = handleDualMarketplaceGet;
export const POST = handleDualMarketplacePost;
