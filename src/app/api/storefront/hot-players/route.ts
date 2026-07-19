import { getHomepageHotPlayers } from "../../../../lib/homepage-hot-players";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const players = await getHomepageHotPlayers();

    return Response.json(
      {
        players,
        generatedAt: new Date().toISOString(),
        refreshHours: 6,
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch (error) {
    console.error("Homepage hot-player feed failed:", error);
    return Response.json(
      {
        players: [],
        generatedAt: new Date().toISOString(),
        refreshHours: 6,
      },
      { status: 200 },
    );
  }
}
