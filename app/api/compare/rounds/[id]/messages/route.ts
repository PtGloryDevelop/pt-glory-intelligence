import {NextResponse} from 'next/server';
import {AuthorizationError, requireRole} from '@/lib/auth/roles';
import {AiError} from '@/lib/ai/deepseek';
import {ask} from '@/lib/ai/rounds';
import {isUuid} from '@/lib/read/request';

export const runtime = 'nodejs';
export const maxDuration = 180;
const PRIVATE = {'Cache-Control': 'private, no-store'};
const MAX_QUESTION = 1000;

/** One question in a round. Spends AI credit within the shared caps; the question and the answer are both kept. */
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    await requireRole('analyst');
    const {id} = await params;
    if (!isUuid(id)) return NextResponse.json({error: 'ไม่พบรอบนี้'}, {status: 404, headers: PRIVATE});
    if (Number(request.headers.get('content-length')) > 8000) return NextResponse.json({error: 'คำถามยาวเกินไป'}, {status: 400, headers: PRIVATE});
    const body = await request.json().catch(() => null) as {question?: unknown} | null;
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > MAX_QUESTION) return NextResponse.json({error: `พิมพ์คำถาม 1–${MAX_QUESTION} ตัวอักษร`}, {status: 400, headers: PRIVATE});
    return NextResponse.json({messages: await ask(id, question)}, {headers: PRIVATE});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AiError) return NextResponse.json({error: error.message}, {status: error.status, headers: PRIVATE});
    console.error('Compare round question failed', error instanceof Error ? error.message : error);
    return NextResponse.json({error: 'AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง'}, {status: 500, headers: PRIVATE});
  }
}
