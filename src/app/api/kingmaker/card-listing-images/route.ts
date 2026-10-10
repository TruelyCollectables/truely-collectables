export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    {
      success: false,
      code: "KINGMAKER_LEGACY_IMAGE_EDITOR_RETIRED",
      error: "Legacy KINGMAKER image editing is retired. Rescan the card through Mac-local InstaComp to replace its canonical front/back archive.",
      sourceOfTruth: "mac_local",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
