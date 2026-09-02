import { NextResponse, type NextRequest } from "next/server";
import { previewImport } from "@/lib/import/preview";
import { requireRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/role-model";

export const runtime = "nodejs";

/** Reads and analyses the file. Writes nothing. */
export async function POST(request: NextRequest) {
  try {
    await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const result = await previewImport(await file.text());
  if (!result.ok) {
    // The server owns the reject decision; the client only displays it.
    return NextResponse.json({ reason: result.reason, detail: result.detail }, { status: 422 });
  }

  const { canonical, ...rest } = result;
  void canonical;
  return NextResponse.json({ fileName: file.name, ...rest });
}
