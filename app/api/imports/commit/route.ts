import { NextResponse, type NextRequest } from "next/server";
import { commitImport } from "@/lib/import/commit";
import { previewImport } from "@/lib/import/preview";
import { readUpload } from "@/lib/import/upload";
import { isUuid } from "@/lib/read/request";
import { requireRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/role-model";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let actor;
  try {
    // Before anything else: the write path runs on a connection that bypasses
    // RLS, so this check is the only authorization boundary it has.
    actor = await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const form = await request.formData();
  const categoryId = String(form.get("categoryId") ?? "");
  const datasetName = String(form.get("datasetName") ?? "").trim();
  const upload = await readUpload(form.get("file"));
  if (!upload.ok) return upload.response;
  if (!categoryId || !datasetName) {
    return NextResponse.json({ error: "categoryId and datasetName are required" }, { status: 400 });
  }
  // Checked here so a malformed id is a 400, not a database syntax error that
  // the generic 500 below would flatten into "import failed".
  if (!isUuid(categoryId)) {
    return NextResponse.json({ error: "categoryId must be a UUID" }, { status: 400 });
  }
  if (datasetName.length > 200) {
    return NextResponse.json({ error: "datasetName is too long" }, { status: 400 });
  }

  const preview = await previewImport(upload.text);
  if (!preview.ok) {
    return NextResponse.json({ reason: preview.reason, detail: preview.detail }, { status: 422 });
  }

  try {
    const result = await commitImport({
      canonical: preview.canonical, categoryId, datasetName, actorId: actor.userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    // Never surface a raw database error: it can carry connection details.
    console.error("import commit failed", error);
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}
