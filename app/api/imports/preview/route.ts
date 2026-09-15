import { NextResponse, type NextRequest } from "next/server";
import { previewImport } from "@/lib/import/preview";
import { readUpload } from "@/lib/import/upload";
import { requireRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/role-model";
import { labelScope } from "@/lib/collect/labels";

export const runtime = "nodejs";

/**
 * Reads and analyses the file. Writes nothing.
 *
 * Admin only (C14): manual import is recovery infrastructure, not a way to
 * collect. An analyst collects through the normal path, which costs money and
 * goes through admission; this one takes a file somebody already has.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const form = await request.formData();
  const upload = await readUpload(form.get("file"));
  if (!upload.ok) return upload.response;

  const result = await previewImport(upload.text);
  if (!result.ok) {
    // The server owns the reject decision; the client only displays it.
    return NextResponse.json({ reason: result.reason, detail: result.detail }, { status: 422 });
  }

  const { canonical, ...rest } = result;
  void canonical;
  // The import screen is an ordinary product surface: it never names the
  // collector, for any role.
  return NextResponse.json({ fileName: upload.name, ...rest, scope: labelScope(rest.scope) });
}
