import {NextResponse} from 'next/server';
import {AuthorizationError, requireRole} from '@/lib/auth/roles';
import {AiError} from '@/lib/ai/deepseek';
import {draftNote, saveNote} from '@/lib/ai/rounds';
import {isUuid} from '@/lib/read/request';

export const runtime = 'nodejs';
export const maxDuration = 180;
const PRIVATE = {'Cache-Control': 'private, no-store'};

/** {action:'draft'}: AI drafts the round's note (spends credit, saves no note). {action:'save', note}: the team's note is kept. */
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    await requireRole('analyst');
    const {id} = await params;
    if (!isUuid(id)) return NextResponse.json({error: 'ไม่พบรอบนี้'}, {status: 404, headers: PRIVATE});
    if (Number(request.headers.get('content-length')) > 12000) return NextResponse.json({error: 'สรุปยาวเกินไป'}, {status: 400, headers: PRIVATE});
    const body = await request.json().catch(() => null) as {action?: unknown; note?: unknown} | null;
    if (body?.action === 'draft') return NextResponse.json({draft: await draftNote(id)}, {headers: PRIVATE});
    if (body?.action === 'save') return NextResponse.json({round: await saveNote(id, body.note)}, {headers: PRIVATE});
    return NextResponse.json({error: 'คำขอไม่ถูกต้อง'}, {status: 400, headers: PRIVATE});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AiError) return NextResponse.json({error: error.message}, {status: error.status, headers: PRIVATE});
    console.error('Compare round note failed', error instanceof Error ? error.message : error);
    return NextResponse.json({error: 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง'}, {status: 500, headers: PRIVATE});
  }
}
