import { NextResponse } from "next/server";
import {
  deliverOrderNotification,
  retryOrderNotifications,
} from "../../../../../lib/order-notifications";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const body = await request.json().catch(() => ({}));
    const notificationId = String(body?.notificationId || "").trim();

    if (notificationId) {
      const result = await deliverOrderNotification({
        supabase,
        storeId,
        notificationId,
      });
      return NextResponse.json({ success: result.sent, result }, { status: result.sent ? 200 : 409 });
    }

    const result = await retryOrderNotifications({
      supabase,
      storeId,
      limit: Number(body?.limit || 50),
    });
    return NextResponse.json(
      { success: result.failed === 0, result },
      { status: result.failed === 0 ? 200 : 207 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Order notification retry failed." },
      { status: 500 },
    );
  }
}
