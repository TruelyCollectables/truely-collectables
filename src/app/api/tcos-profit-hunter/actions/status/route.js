import {
  authorizeProfitHunterAction,
  noStoreJson,
} from "../../../../../lib/tcos-profit-hunter-action-http.mjs";
import { getProfitHunterActionStatus } from "../../../../../lib/tcos-profit-hunter-action-service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  const unauthorized = authorizeProfitHunterAction(request);
  if (unauthorized) return unauthorized;
  return noStoreJson(getProfitHunterActionStatus());
}
