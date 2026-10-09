import {cookies} from 'next/headers';
import {forbidden} from 'next/navigation';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {HOME_COOKIE,parseHomeChoice} from '@/lib/home-choice';
import {OwnedPerformance} from '../../owned-performance';

export const dynamic='force-dynamic';
export default async function Page(){
  const actor=await requireActorOrRedirect();
  if(!satisfies(actor.role,'analyst'))forbidden();
  // The sync runs the Ads Management project from this server's disk; only a server set up for it can.
  const canSync=Boolean(process.env.OWNED_MANAGEMENT_PROJECT_PATH&&process.env.OWNED_MANAGEMENT_AUTHORIZED_EMAIL);
  return <OwnedPerformance home={parseHomeChoice((await cookies()).get(HOME_COOKIE)?.value)} canSync={canSync}/>;
}
