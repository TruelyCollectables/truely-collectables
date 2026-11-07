# Admin and InstaComp Mobile production redeploy

Triggered: 2026-07-31 10:09 America/Denver

This commit intentionally triggers a fresh production deployment from `main` for the owner navigation changes already merged, including:

- Public storefront **Admin** entry
- Mobile **Admin** navigation entry
- `/admin` owner quick-launch tray
- `/admin/instacomp/mobile`
- Card Studio, Products, and Orders shortcuts

Expected production verification:

1. TruelyCollectables.com header shows **Admin**.
2. Mobile navigation shows **Admin**.
3. `/admin` shows the owner quick-launch tray.
4. InstaComp Mobile opens from the admin workflow.
