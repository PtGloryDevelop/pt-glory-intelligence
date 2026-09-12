import type { NextRequest } from "next/server";
import { getAdDetail, getObservationHistory } from "@/lib/read/queries";
import { labelProvenanceRows } from "@/lib/collect/labels";
import { badRequest, notFound, readRoute } from "@/lib/read/guard";
import { signArchivedPreviews } from "@/lib/media/presentation";
import { isAdArchiveId, isUuid } from "@/lib/read/request";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ adArchiveId: string }> },
) {
  const { adArchiveId } = await params;
  const datasetId = request.nextUrl.searchParams.get("datasetId");

  return readRoute(async () => {
    if (!isAdArchiveId(adArchiveId)) return badRequest("ad id must be numeric");
    if (datasetId !== null && !isUuid(datasetId)) return badRequest("datasetId must be a UUID");

    const detail = await getAdDetail(adArchiveId, datasetId);
    // Asking for an ad in a dataset it does not belong to is a wrong request,
    // not one to guess at. Falling back to master state here would quietly show
    // latest values under a snapshot heading.
    if (!detail) return notFound();

    const signed = await signArchivedPreviews([detail]);
    return {
      detail: {
        ...detail,
        archive_url: detail.archive_path ? signed.get(detail.archive_path) ?? null : null,
      },
      // The drawer's history carries collection_method. Labelled here so the
      // JSON body itself never names a collector, whoever is reading.
      history: labelProvenanceRows(await getObservationHistory(adArchiveId)),
    };
  });
}
