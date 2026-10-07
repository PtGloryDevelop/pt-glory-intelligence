import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {legacyPerformanceHref} from '@/lib/owned-ads/performance-navigation';
import {HOME_COOKIE,parseHomeChoice} from '@/lib/home-choice';
import {Dashboard} from './dashboard';
export const dynamic = "force-dynamic";
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const actor=await requireActorOrRedirect();
  const canAnalyze=satisfies(actor.role,'analyst');
  const legacy=legacyPerformanceHref(await searchParams);
  if(canAnalyze&&legacy)redirect(legacy);
  // Viewers cannot open the library, so their home is always the overview.
  const home=parseHomeChoice((await cookies()).get(HOME_COOKIE)?.value);
  if(canAnalyze&&home==='library')redirect('/owned-ads/performance');
  return <Dashboard canAnalyze={canAnalyze} home={home}/>;
}
