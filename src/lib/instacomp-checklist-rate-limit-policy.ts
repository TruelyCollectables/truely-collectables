import type { InstaCompMutationChannel } from "./instacomp-mutation-security";

/**
 * The dedicated InstaComp service token is an authenticated internal
 * service-to-service channel. It must never consume the public abuse bucket;
 * high-volume Registry certification and torture tests are expected traffic.
 *
 * Seller bearer requests and browser-admin requests remain public-facing
 * channels and continue to use the existing public endpoint rate limiter.
 * Unknown/null channels fail closed by remaining rate limited.
 */
export function shouldApplyInstaCompChecklistPublicRateLimit(
  channel: InstaCompMutationChannel | null,
) {
  return channel !== "service_token";
}
