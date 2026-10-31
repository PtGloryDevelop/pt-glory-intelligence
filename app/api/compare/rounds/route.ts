import {NextResponse} from 'next/server';
import {AuthorizationError, requireRole} from '@/lib/auth/roles';
import {parseAdRefs} from '@/lib/ai/compare';
import {AiError} from '@/lib/ai/deepseek';
import {createRound, listRounds} from '@/lib/ai/rounds';

export const runtime = 'nodejs';
export const maxDuration = 180;
const PRIVATE = {'Cache-Control': 'private, no-store'};

const failed = (error: unknown, message: string) => {
  if (error instanceof AuthorizationError || error instanceof AiError) return NextResponse.json({error: error.message}, {status: error.status, headers: PRIVATE});
  console.error(message, error instanceof Error ? error.message : error);
  return NextResponse.json({error: 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง'}, {status: 500, headers: PRIVATE});
};

/** The team's compare rounds. Analysts: rounds name our ads and units. */
export async function GET(request: Request) {
  try {
    await requireRole('analyst');
    const params = new URL(request.url).searchParams;
    const unit = params.get('unit')?.trim().slice(0, 120) || undefined;
    return NextResponse.json({rounds: await listRounds({unit, noted: params.get('noted') === '1', mine: params.get('mine') === '1'})}, {headers: PRIVATE});
  } catch (error) { return failed(error, 'Compare rounds list failed'); }
}

/** A new round on the pair on screen. Free when the comparison has already been read. */
export async function POST(request: Request) {
  try {
    await requireRole('analyst');
    if (Number(request.headers.get('content-length')) > 4000) return NextResponse.json({error: 'Invalid request'}, {status: 400, headers: PRIVATE});
    const body = await request.json().catch(() => null) as {ads?: unknown; view?: unknown; unitName?: unknown} | null;
    const refs = parseAdRefs(body?.ads);
    if (!refs) return NextResponse.json({error: 'เลือก 2–5 แอด และต้องมีแอดของเราอย่างน้อย 1 ตัว'}, {status: 400, headers: PRIVATE});
    const view = body?.view === 'ads' ? 'ads' : 'general';
    const unitName = typeof body?.unitName === 'string' ? body.unitName : null;
    return NextResponse.json({round: await createRound(refs, view, unitName)}, {status: 201, headers: PRIVATE});
  } catch (error) { return failed(error, 'Compare round start failed'); }
}
