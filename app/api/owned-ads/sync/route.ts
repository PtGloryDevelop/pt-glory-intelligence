import { after, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { dbUser } from "@/lib/db/user";
import { ownedReportRoute } from "@/lib/owned-ads/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST() {
  return ownedReportRoute(async actor => {
    if (!process.env.OWNED_MANAGEMENT_PROJECT_PATH || !process.env.OWNED_MANAGEMENT_AUTHORIZED_EMAIL) {
      return NextResponse.json({error:"ยังไม่ได้ตั้งค่าการเชื่อม Ads Management ฝั่งเซิร์ฟเวอร์"},{status:503});
    }
    const db = await dbUser();
    const running = await db.from("owned_library_syncs").select("id,started_at").eq("status","running").maybeSingle();
    if (running.error) return NextResponse.json({error:"ระบบซิงค์ยังไม่พร้อมใช้งาน"},{status:503});
    if (running.data && Date.now()-Date.parse(running.data.started_at)<20*60_000) {
      return NextResponse.json({accepted:true,reused:true,id:running.data.id},{status:202});
    }
    after(async () => {
      try {
        await promisify(execFile)(process.execPath,["--experimental-strip-types",resolve(process.cwd(),"scripts/sync-owned-library.mjs"),actor.userId],{
          cwd:process.cwd(),env:process.env,windowsHide:true,timeout:20*60_000,maxBuffer:1024*1024,
        });
      } catch {
        console.error("Owned library worker did not finish; check sync status");
      }
    });
    return NextResponse.json({accepted:true,reused:false},{status:202});
  });
}
