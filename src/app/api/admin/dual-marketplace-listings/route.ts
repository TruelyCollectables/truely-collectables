import {
  handleDualMarketplaceGet,
  handleDualMarketplacePost,
} from "../../../../lib/dual-marketplace-admin-route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export const GET = handleDualMarketplaceGet;
export const POST = handleDualMarketplacePost;
