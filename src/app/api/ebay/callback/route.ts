import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
console.log("eBay callback route hit");
  return NextResponse.json({
    success: true,
    message: "eBay callback received",
    has_code: !!code,
    code_preview: code ? code.slice(0, 20) + "..." : null,
  });
}