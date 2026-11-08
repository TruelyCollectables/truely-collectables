// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Cloudflare adapter is installed ephemerally in the Cloudflare build pipeline.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext configuration for the Truely Collectables Cloudflare cutover.
 *
 * Keep the initial deployment free of optional account-level cache bindings so
 * the Worker can be validated before DNS moves. R2/DO-backed incremental cache
 * bindings can be added deliberately after the production runtime is healthy.
 */
export default defineCloudflareConfig({});
