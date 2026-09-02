import { getDatasetContext, getDatasetQuality } from "@/lib/read/queries";
import { badRequest, notFound, readRoute } from "@/lib/read/guard";
import { isUuid } from "@/lib/read/request";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    if (!isUuid(id)) return badRequest("dataset id must be a UUID");
    const context = await getDatasetContext(id);
    if (!context) return notFound();
    return { context, quality: await getDatasetQuality(id) };
  });
}
