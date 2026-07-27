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

## Production deployment safety

The deployment helper command-pins Vercel CLI `56.2.0` and runs it through isolated `npm exec --package=vercel@56.2.0` without a machine-global `vercel` command. Its temporary cache stays outside application `node_modules` and the lockfile. Every Vercel call receives `--cwd` with the repository root.

`VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens. Flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped values fail before quota status, preflight, Git fetch, or Vercel CLI work.

Production deploy and smoke target overrides accept only valid DNS hostnames or root HTTP(S) URLs. Smoke therefore cannot silently discard an unsafe suffix. Smoke request timeout overrides must be integer milliseconds from `1000` through `120000`; malformed, infinite, fractional, zero, negative, or too-large values fail before admin auth, Git fetch, or network requests.

Normal deploys also enforce the local quota cooldown before npm exec or Git fetch. Unwanted-alias cleanup must succeed or the deployment is not treated as complete.
