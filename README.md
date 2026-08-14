# Truely Collectables

Truely Collectables is deployed on Cloudflare Workers with OpenNext. The owned
production domains are:

- https://truelycollectables.com
- https://www.truelycollectables.com

## Production ownership

- Worker entrypoint: `cloudflare-worker.ts`
- Worker configuration: `wrangler.jsonc`
- Next.js adapter configuration: `open-next.config.ts`
- Production scheduler: Cloudflare Workers cron trigger
- Runtime secrets: Cloudflare Worker secrets
- Source of truth: GitHub `main`

The production Worker adds `X-Truely-Origin: cloudflare-worker` to responses.

## Local development

```bash
npm ci
npm run dev
```

## Verification

```bash
npm run lint
npm run check:production-guardrails
npm run preflight:production
npm run smoke:production
```

The production guardrail fails if retired deployment configuration, packages,
API calls, CLI commands, or credentials return to operational code.

## Deployment

Production deployments are owned by the Cloudflare pipeline on `main`. Do not
put secrets in the repository, logs, screenshots, tickets, or chat. Keep the
encrypted recovery vault and its recovery key in separate secure locations.
