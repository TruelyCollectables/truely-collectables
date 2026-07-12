import { NextResponse } from "next/server";
import { runLaunchGateDrill } from "../../../../lib/launch-gate-drill";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const report = await runLaunchGateDrill({ supabase });
    return NextResponse.json({ success: true, report });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not run the launch gate drill.",
      },
      { status: 500 },
    );
  }
}
