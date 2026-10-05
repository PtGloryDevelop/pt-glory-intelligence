import { NextResponse } from "next/server";
import { AuthorizationError, requireRole } from "@/lib/auth/roles";
import { supabaseArchiveStore } from "@/lib/media/store-supabase";
import { thumbPath } from "@/lib/owned-ads/thumbs";

/** Our archived ad picture → a short-lived signed link. Company creatives are analyst data. */
export async function GET(_request: Request, { params }: { params: Promise<{ account: string; ad: string }> }) {
  try {
    await requireRole("analyst");
    const { account, ad } = await params;
    if (!/^(act_)?\d{1,32}$/.test(account) || !/^\d{1,32}$/.test(ad)) return NextResponse.json({ error: "Invalid ad" }, { status: 400 });
    const url = await supabaseArchiveStore().getPresentationUrl(thumbPath(account, ad), 3600);
    if (!url) return NextResponse.json({ error: "Not archived" }, { status: 404 });
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=1800" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
