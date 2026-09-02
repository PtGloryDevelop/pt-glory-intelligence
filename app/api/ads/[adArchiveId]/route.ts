import { NextResponse, type NextRequest } from "next/server";
import { getAdDetail, getObservationHistory } from "@/lib/read/queries";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ adArchiveId: string }> },
) {
  const { adArchiveId } = await params;
  const datasetId = request.nextUrl.searchParams.get("datasetId");

  const detail = await getAdDetail(adArchiveId, datasetId);
  // Asking for an ad in a dataset it does not belong to is a wrong request, not
  // one to guess at. Falling back to master state here would quietly show
  // latest values under a snapshot heading.
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ detail, history: await getObservationHistory(adArchiveId) });
}
