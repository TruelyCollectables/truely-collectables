// Incident diagnostic trigger: this same-repository PR exists only to expose the Actions run/logs.
const VERSION = "emergency-v1";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Truely Collectables</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#09090b;color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(720px,100%);background:#18181b;border:1px solid #3f3f46;border-radius:18px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 14px;font-size:clamp(28px,6vw,48px)}p{color:#d4d4d8;line-height:1.6;font-size:17px}.badge{display:inline-block;border:1px solid #52525b;border-radius:999px;padding:7px 11px;font-size:13px;color:#e4e4e7;margin-bottom:20px}.note{margin-top:22px;padding:16px;border-radius:12px;background:#27272a;color:#fafafa}a{color:#fff}</style>
</head>
<body>
  <main class="card">
    <div class="badge">Truely Collectables</div>
    <h1>Storefront is temporarily refreshing.</h1>
    <p>We are keeping the site reachable while inventory services recover. Live purchasing is temporarily paused so we never sell a card without confirming current availability.</p>
    <div class="note">Please check back shortly. Your inventory and account data are not being served from a stale checkout path.</div>
  </main>
</body>
</html>`;

function headers(contentType: string) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-truely-origin": "cloudflare-emergency-worker",
    "x-truely-edge-version": VERSION,
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/__edge-health") {
      return Response.json(
        {
          ok: true,
          schema: "TRUELY_EDGE_HEALTH_V1",
          databaseIndependent: true,
          emergencyMode: true,
          failsafeVersion: VERSION,
        },
        { status: 200, headers: headers("application/json; charset=utf-8") },
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Storefront maintenance in progress", {
        status: 503,
        headers: headers("text/plain; charset=utf-8"),
      });
    }

    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/account") ||
      url.pathname.startsWith("/checkout") ||
      url.pathname.startsWith("/cart")
    ) {
      return new Response(html, {
        status: 503,
        headers: headers("text/html; charset=utf-8"),
      });
    }

    return new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: headers("text/html; charset=utf-8"),
    });
  },

  async scheduled(): Promise<void> {
    // Intentionally no-op while emergency storefront mode is active.
  },
};
