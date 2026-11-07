import {
  actionErrorResponse,
  authorizeProfitHunterAction,
  noStoreJson,
  readJsonObject,
} from "../../../../../lib/tcos-profit-hunter-action-http.mjs";
import { verifyProfitHunterAction } from "../../../../../lib/tcos-profit-hunter-action-service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  const unauthorized = authorizeProfitHunterAction(request);
  if (unauthorized) return unauthorized;

  try {
    const input = await readJsonObject(request);
    return noStoreJson(await verifyProfitHunterAction(input));
  } catch (error) {
    return actionErrorResponse(error);
  }
}
