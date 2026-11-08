# Final hardening rerun

This marker restarts the complete trusted audit matrix after the shipment-notification and buyer-account production guards were aligned with the current safer architecture.

- Scope: PR #393 release candidate
- Required result: all code, dependency, payment, inventory, shipping, security, fulfillment, and build lanes green
- Buyer policy: buyer accounts require no card verification; seller verification remains fail-closed in seller onboarding
- Finalizer build environment: standard build-only Supabase, Stripe, admin, and eBay placeholders are present for page-data collection
- Production/live-domain lane remains a deployment verification gate and must not be treated as green before release
