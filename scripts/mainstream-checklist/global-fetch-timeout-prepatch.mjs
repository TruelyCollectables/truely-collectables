const originalFetch = globalThis.fetch.bind(globalThis);
const DEFAULT_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(120_000, Number(process.env.MASTER_CHECKLIST_FETCH_TIMEOUT_MS || 60_000)),
);

function hasSignal(input, init) {
  return Boolean(init?.signal || (typeof Request !== "undefined" && input instanceof Request && input.signal));
}

globalThis.fetch = async function checklistGlobalTimeoutFetch(input, init = {}) {
  if (hasSignal(input, init)) return originalFetch(input, init);
  return originalFetch(input, {
    ...init,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
};
