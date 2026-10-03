import "server-only";
import { NextResponse } from "next/server";
import { AuthorizationError, requireRole, type Actor } from "../auth/roles.ts";
import { dbUser } from "../db/user.ts";
import { OwnedImportError, type OwnedAdImport } from "./import.ts";
import type { OwnedAdReport, OwnedAdReportSummary } from "./model.ts";

const SUMMARY_FIELDS = "id,name,account_name,currency,date_start,date_end,source_label,imported_at,row_count";
const REPORT_FIELDS = "id,name,account_name,currency,date_start,date_end,source_label,imported_at,rows";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

class OwnedReportStoreError extends Error {}

/** Guards reads as well as imports: company performance is analyst/admin data. */
export async function ownedReportRoute(run: (actor: Actor) => Promise<NextResponse>): Promise<NextResponse> {
  try {
    const actor = await requireRole("analyst");
    const response = await run(actor);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof OwnedImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    if (error instanceof OwnedReportStoreError) {
      return NextResponse.json({ error: "ระบบรายงานของบริษัทยังไม่พร้อมใช้งาน โปรดลองอีกครั้ง" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ error: "ไม่สามารถดำเนินการกับรายงานได้ในขณะนี้" }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function listOwnedAdReports(): Promise<OwnedAdReportSummary[]> {
  const db = await dbUser();
  const { data, error } = await db.from("owned_ad_reports")
    .select(SUMMARY_FIELDS).order("imported_at", { ascending: false }).limit(100);
  if (error) throw new OwnedReportStoreError();
  return (data ?? []) as OwnedAdReportSummary[];
}

export async function getOwnedAdReport(id: string): Promise<OwnedAdReport | null> {
  const db = await dbUser();
  const { data, error } = await db.from("owned_ad_reports").select(REPORT_FIELDS).eq("id", id).maybeSingle();
  if (error) throw new OwnedReportStoreError();
  return data as OwnedAdReport | null;
}

/** One insert stores the complete snapshot atomically under the caller's JWT/RLS. */
export async function createOwnedAdReport(input: OwnedAdImport, actor: Actor): Promise<OwnedAdReport> {
  const db = await dbUser();
  const { data, error } = await db.from("owned_ad_reports")
    .insert({ ...input, created_by: actor.userId }).select(REPORT_FIELDS).single();
  if (error) {
    if (error.code === "42501") throw new AuthorizationError(403, "Requires analyst role");
    throw new OwnedReportStoreError();
  }
  return data as OwnedAdReport;
}
