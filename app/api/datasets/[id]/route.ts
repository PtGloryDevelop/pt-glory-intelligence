import { NextResponse } from "next/server";
import { getDatasetContext, getDatasetQuality } from "@/lib/read/queries";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getDatasetContext(id);
  if (!context) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ context, quality: await getDatasetQuality(id) });
}
