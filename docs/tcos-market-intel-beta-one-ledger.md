# TCOS Market Intel™ Beta One — Purchase Ledger

## Scope

This first Beta One application slice adds a private admin purchase ledger for collectible investments and wholesale lots.

## Admin routes

- `/admin/market-intel`
- `/admin/market-intel/purchases`
- `/admin/market-intel/purchases/[id]`

## API routes

- `POST /api/admin/market-intel/sales`
- `POST /api/admin/market-intel/purchases/[id]/receive`

## What it tracks

- Total delivered acquisition cost
- Unit cost basis
- Quantity purchased, sold, and remaining
- Gross item sales
- Shipping collected
- Marketplace and payment-processing fees
- Actual postage and supplies
- Net proceeds
- Realized gross profit
- Cash break-even progress

## Security

The existing `proxy.ts` protects all `/admin/*` and `/api/admin/*` routes. The data layer uses the existing server-only Supabase admin client and requires `SUPABASE_SERVICE_ROLE_KEY` in production.

## Database prerequisite

Migration `TCOS Market Intel™ Beta One 001` must be applied in Supabase before these routes are used. The migration creates the `tcos_mi_*` tables and seeds Purchase Record #1 for the Ivan Demidov NHCD-31 50-card lot at $37 delivered.
