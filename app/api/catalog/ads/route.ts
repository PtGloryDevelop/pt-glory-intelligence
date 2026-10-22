import type { NextRequest } from 'next/server';
import { getCatalogAds } from '@/lib/read/catalog';
import { badRequest, readRoute } from '@/lib/read/guard';
import { activeFilter, filterValue, isAdArchiveId, pageList, pageOffset, pageSize, searchValue } from '@/lib/read/request';

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
    const pages=pageList(params.get('pages'));
    if(!pages.ok)return badRequest('pages must be 1-60 numeric page ids');
    const sort=params.get('sort');
    if(sort!==null&&sort!=='new'&&sort!=='age')return badRequest('sort must be new or age');
    return getCatalogAds({ search: searchValue(params.get('search')), active: active.value,
      pageIds: pages.value, sort,
      adArchiveId,
      firstSeenSince:period==='week'?new Date(Date.now()-7*86_400_000).toISOString():undefined,
      format: filterValue(params.get('format')), limit: Math.min(pageSize(params.get('limit') ?? '24'), 24),
      offset: pageOffset(params.get('offset')) });
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
