import { NextResponse } from "next/server";
import { MAX_BYTES } from "../collector/contract.ts";

/**
 * Turns an uploaded file into text, refusing an oversized one before reading it.
 *
 * validateRaw() also checks MAX_BYTES, but only after the whole upload has been
 * buffered into a string. Checking the declared size first means a 500 MB post
 * never becomes 500 MB of process memory.
 */
export async function readUpload(
  file: unknown,
): Promise<{ ok: true; name: string; text: string } | { ok: false; response: NextResponse }> {
  if (!(file instanceof File)) {
    return { ok: false, response: NextResponse.json({ error: "file is required" }, { status: 400 }) };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { reason: "size_limit_exceeded", detail: `file exceeds ${MAX_BYTES} bytes` },
        { status: 413 },
      ),
    };
  }
  return { ok: true, name: file.name, text: await file.text() };
}
