import {NextResponse} from 'next/server';
import {AuthorizationError, requireRole} from '@/lib/auth/roles';
import {AiError, parseAdRefs, runComparison} from '@/lib/ai/compare';

export const runtime = 'nodejs';
export const maxDuration = 180;
const PRIVATE = {'Cache-Control': 'private, no-store'};

/** Analysts only: reads our performance and spends AI credit. dryRun never calls OpenAI. */
export async function POST(request: Request) {
  try {
    await requireRole('analyst');
    if (Number(request.headers.get('content-length')) > 4000) return NextResponse.json({error: 'Invalid request'}, {status: 400, headers: PRIVATE});
    const body = await request.json().catch(() => null) as {ads?: unknown; dryRun?: unknown} | null;
    const refs = parseAdRefs(body?.ads);
    if (!refs) return NextResponse.json({error: 'เลือก 2–5 แอด และต้องมีแอดของเราอย่างน้อย 1 ตัว'}, {status: 400, headers: PRIVATE});
    return NextResponse.json(await runComparison(refs, body?.dryRun === true), {headers: PRIVATE});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AiError) return NextResponse.json({error: error.message}, {status: error.status, headers: PRIVATE});
    console.error('AI compare failed', error instanceof Error ? error.message : error);
    return NextResponse.json({error: 'วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง'}, {status: 500, headers: PRIVATE});
  }
}
