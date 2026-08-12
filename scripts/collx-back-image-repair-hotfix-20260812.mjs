// Supabase Storage returns HTTP 400 for a missing public object in this project.
// The repair script previously treated that as fatal instead of copying the exact CollX source back.
const nativeFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const response = await nativeFetch(input, init);
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : String(input?.url || "");
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  const isOwnedBackProbe =
    method === "HEAD" &&
    rawUrl.includes("/storage/v1/object/public/truely-product-images/collx-full/20260811/") &&
    /\/back\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(rawUrl);

  if (isOwnedBackProbe && response.status === 400) {
    return new Response(null, {
      status: 404,
      statusText: "Missing owned back object",
      headers: response.headers,
    });
  }
  return response;
};

await import("./collx-back-image-repair-20260812.mjs");
