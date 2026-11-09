import { NextRequest, NextResponse } from "next/server";
import { getConfiguredInstaCompMacKey, getConfiguredInstaCompMacUrl } from "../../../../../../lib/instacomp-mac-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CloudflareFetchGlobal = typeof globalThis & {
  __TRUELY_CLOUDFLARE_NATIVE_FETCH__?: typeof fetch;
};

function getServerFetch(): typeof fetch {
  const nativeFetch = (globalThis as CloudflareFetchGlobal)
    .__TRUELY_CLOUDFLARE_NATIVE_FETCH__;
  return typeof nativeFetch === "function" ? nativeFetch : fetch;
}

export async function POST(request: NextRequest) {
  const referrer = request.headers.get("referer") || "";
  const returnPath = referrer.includes("/kingmaker/sourcing")
    ? "/kingmaker/sourcing"
    : "/admin/market-intel/deal-hunter";

  try {
    const baseUrl = getConfiguredInstaCompMacUrl();
    const key = getConfiguredInstaCompMacKey();
    if (!baseUrl || !key) {
      return NextResponse.redirect(
        new URL(
          `${returnPath}?error=Mac+connection+not+configured+in+Production`,
          request.url,
        ),
        303,
      );
    }

    const macResponse = await getServerFetch()(`${baseUrl}/v1/deal-hunter/run`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Accept": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    const payload = (await macResponse.json().catch(() => null)) as Record<string, unknown> | null;
    if (!macResponse.ok || !payload) {
      const detail = String(payload?.detail || payload?.error || `HTTP ${macResponse.status}`);
      return NextResponse.redirect(
        new URL(`${returnPath}?error=${encodeURIComponent(detail)}`, request.url),
        303,
      );
    }

    return NextResponse.redirect(
      new URL(`${returnPath}?triggered=1`, request.url),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trigger request failed";
    return NextResponse.redirect(
      new URL(`${returnPath}?error=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }
}
