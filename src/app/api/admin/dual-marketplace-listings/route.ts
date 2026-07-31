import {
  handleGuardedDualMarketplaceGet,
  handleGuardedDualMarketplacePost,
} from "../../../../lib/dual-marketplace-admin-route-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export const GET = handleGuardedDualMarketplaceGet;
export const POST = handleGuardedDualMarketplacePost;
