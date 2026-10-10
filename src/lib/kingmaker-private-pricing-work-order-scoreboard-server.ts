import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingScoreboard } from "./kingmaker-mac-server";
export async function getKingmakerWorkOrderScoreboard(actor: InstaCompJobActor) {
  if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required for the KINGMAKER operations scoreboard.",403,"KINGMAKER_SCOREBOARD_ADMIN_REQUIRED");
  return (await getKingmakerMacPricingScoreboard()).scoreboard;
}
