import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {redirect} from 'next/navigation';
import {legacyPerformanceHref} from '@/lib/owned-ads/performance-navigation';
import {Dashboard} from './dashboard';
export const dynamic = "force-dynamic";
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const actor=await requireActorOrRedirect();
  const canAnalyze=satisfies(actor.role,'analyst');
  const legacy=legacyPerformanceHref(await searchParams);
  if(canAnalyze&&legacy)redirect(legacy);
  return <Dashboard canAnalyze={canAnalyze}/>;
}
