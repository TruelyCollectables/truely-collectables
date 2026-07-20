FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV MARKET_INTEL_WORKER_INTERVAL_MINUTES=15
ENV MARKET_INTEL_WORKER_NAME=online-private-worker

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node scripts/run-market-intel-external-worker.ts ./scripts/run-market-intel-external-worker.ts
COPY --chown=node:node scripts/run-market-intel-worker-service.mjs ./scripts/run-market-intel-worker-service.mjs
COPY --chown=node:node src/lib/market-intel-ebay-queries.ts ./src/lib/market-intel-ebay-queries.ts

USER node
STOPSIGNAL SIGTERM

# Default: always-on service loop. A cloud scheduler can override this command
# with the one-cycle worker documented in README.md.
CMD ["node", "scripts/run-market-intel-worker-service.mjs"]
