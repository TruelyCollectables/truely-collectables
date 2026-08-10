export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (String(process.env.VERCEL_ENV || "") !== "preview") {
    return Response.json({ success: false }, { status: 404 });
  }
  return Response.json(
    {
      success: true,
      vercelRuntime: process.env.VERCEL === "1",
      vercelOidcPresent: Boolean(String(process.env.VERCEL_OIDC_TOKEN || "").trim()),
      aiGatewayApiKeyPresent: Boolean(String(process.env.AI_GATEWAY_API_KEY || "").trim()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
