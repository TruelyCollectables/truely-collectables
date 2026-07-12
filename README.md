# Truely Collectables / TCOS

Copyright 2026 Dag Danky Holdings LLC. All rights reserved.

Authored by David Bakanas.

Software ownership: Dag Danky Holdings LLC.

This repository contains the Truely Collectables storefront and TCOS admin system.

Start with the operator manual:

- [TCOS Operator Manual](docs/TCOS_OPERATOR_MANUAL.md)
- [TCOS Operator Manual PDF](docs/TCOS_OPERATOR_MANUAL.pdf)
- [Production Deploy Runbook](docs/PRODUCTION_DEPLOY_RUNBOOK.md)

The manual explains daily store operation, inventory, orders, offers, eBay sync, AI descriptions, sales comps, suggested pricing, and required environment variables.

When the mobile app is built, maintain its operator manual and downloadable PDF separately from the main TCOS web manual while keeping shared policies consistent.

Customer legal page:

- [Terms of Service](src/app/terms/page.tsx)
- [Seller Terms of Service](src/app/seller-terms/page.tsx)

To regenerate the downloadable manual PDF:

```bash
npm run manual:pdf
```

## Production deploy and smoke

Use the production runbook when shipping queued launch work:

```bash
npm run verify:production
npm run launch:production
```

The verify helper runs lint, build, and GitHub/clean-worktree preflight without starting a Vercel deploy. The launch helper runs that same verification first, then deploys production and runs the production smoke if the deploy succeeds. The deploy step verifies Git state, handles the clean Vercel production alias, removes the unwanted `tt3b` alias if it appears, and reports Vercel quota blocks clearly.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Do not use the generic Vercel template flow for TCOS production.

Use the checked production launch helper:

```bash
npm run launch:production
```

That command runs lint, build, GitHub/clean-worktree preflight, production deploy, clean-domain aliasing, unwanted `tt3b` alias removal, and production smoke in order.

See [Production Deploy Runbook](docs/PRODUCTION_DEPLOY_RUNBOOK.md) for details.
