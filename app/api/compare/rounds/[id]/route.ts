import {NextResponse} from 'next/server';
import {AuthorizationError, requireRole} from '@/lib/auth/roles';
import {AiError} from '@/lib/ai/deepseek';
import {getRound} from '@/lib/ai/rounds';
import {isUuid} from '@/lib/read/request';

export const runtime = 'nodejs';
const PRIVATE = {'Cache-Control': 'private, no-store'};

/** One round: its ads, the summary then, the talk and the note. */
export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    await requireRole('analyst');
    const {id} = await params;
    if (!isUuid(id)) return NextResponse.json({error: 'ไม่พบรอบนี้'}, {status: 404, headers: PRIVATE});
    const round = await getRound(id);
    return round ? NextResponse.json({round}, {headers: PRIVATE}) : NextResponse.json({error: 'ไม่พบรอบนี้'}, {status: 404, headers: PRIVATE});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AiError) return NextResponse.json({error: error.message}, {status: error.status, headers: PRIVATE});
    console.error('Compare round read failed', error instanceof Error ? error.message : error);
    return NextResponse.json({error: 'เปิดรอบนี้ไม่สำเร็จ'}, {status: 500, headers: PRIVATE});
  }
}
