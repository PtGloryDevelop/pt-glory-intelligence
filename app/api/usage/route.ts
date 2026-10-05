import {NextResponse} from 'next/server';
import {AuthorizationError, requireRole} from '@/lib/auth/roles';
import {readUsage} from '@/lib/usage/read';

export async function GET() {
  try {
    const actor = await requireRole('analyst');
    return NextResponse.json(await readUsage(actor), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({error: error.message}, {status: error.status});
    return NextResponse.json({error: 'unavailable'}, {status: 503});
  }
}
