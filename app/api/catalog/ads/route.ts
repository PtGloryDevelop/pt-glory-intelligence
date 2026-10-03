import type { NextRequest } from 'next/server';
import { getCatalogAds } from '@/lib/read/catalog';
import { badRequest, readRoute } from '@/lib/read/guard';
import { activeFilter, filterValue, isAdArchiveId, pageOffset, pageSize, searchValue } from '@/lib/read/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const response = await readRoute(async () => {
    const params = request.nextUrl.searchParams;
    const active = activeFilter(params.get('active'));
    if (!active.ok) return badRequest('active must be active, inactive or unknown');
    const adArchiveId = params.get('ad');
    if (adArchiveId !== null && !isAdArchiveId(adArchiveId)) return badRequest('ad must be numeric');
    const period=params.get('period');
    if(period!==null&&period!=='week')return badRequest('period must be week');
    return getCatalogAds({ search: searchValue(params.get('search')), active: active.value,
      adArchiveId,
      firstSeenSince:period==='week'?new Date(Date.now()-7*86_400_000).toISOString():undefined,
      format: filterValue(params.get('format')), limit: Math.min(pageSize(params.get('limit') ?? '24'), 24),
      offset: pageOffset(params.get('offset')) });
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
