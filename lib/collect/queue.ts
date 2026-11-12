import type {PoolClient} from 'pg';
import {assessBudget,CONCURRENCY_SLOT_STATES,microsToUsd,usdToMicros} from './budget.ts';

/** The same lock protects enqueue idempotency and the budget/slot decision at dispatch. */
export const ADMISSION_LOCK_NAMESPACE='pt_glory.collector.admission';
/** Verified account limit, 2026-11-12. A setting may lower, never exceed, this bound. */
export const MAX_CONCURRENT_COLLECTIONS=5;
export const QUEUE_RECHECK_SECONDS=10;

type Reservation={ok:true;reservedUsd:string}|{ok:false;reason:string};

/** Caller holds ADMISSION_LOCK_NAMESPACE before taking any request row lock. No provider I/O here. */
export async function reserveQueueStart(client:PoolClient,requestId:string,now:Date):Promise<Reservation>{
  const {rows:settingRows}=await client.query<{key:string;value:unknown}>(
    "select key,value from public.app_settings where key like 'collector.%'",
  );
  const settings=new Map(settingRows.map(row=>[row.key,row.value]));
  const read=(key:string)=>settings.get('collector.'+key)??null;
  // These must be present before reserving money or committing a start marker.
  if(typeof read('actor_build')!=='string'||!(read('actor_build') as string).trim()
    ||typeof read('run_timeout_minutes')!=='number'||(read('run_timeout_minutes') as number)<=0){
    return {ok:false,reason:'not_configured'};
  }
  const {rows:older}=await client.query(
    `select 1 from public.collection_requests
      where status='queued' and requires_admin=false
        and (created_at,id)<(select created_at,id from public.collection_requests where id=$1)
      limit 1`,[requestId],
  );
  if(older.length)return {ok:false,reason:'earlier_request'};
  const {rows:requests}=await client.query(
    `select status,cost_status,cost_reserved_usd,cost_provisional_usd,cost_final_usd,
            reservation_released_at,started_at
       from public.collection_requests
      where id<>$1 and ((cost_status<>'final' and reservation_released_at is null) or cost_status='final')`,
    [requestId],
  );
  const {rows:live}=await client.query<{status:string}>(
    'select status from public.collection_requests where status=any($1::text[])',
    [CONCURRENCY_SLOT_STATES.filter(status=>status!=='queued')],
  );
  const configured=read('max_concurrent');
  const maxConcurrent=typeof configured==='number'&&Number.isInteger(configured)&&configured>0
    ?Math.min(configured,MAX_CONCURRENT_COLLECTIONS):null;
  const assessment=assessBudget({settings:{
    enabled:read('enabled'),monthly_budget_usd:read('monthly_budget_usd'),
    max_charge_per_run_usd:read('max_charge_per_run_usd'),billing_cycle_anchor:read('billing_cycle_anchor'),
    billing_cycle_length_months:read('billing_cycle_length_months'),
  },requests,liveRequests:live,maxConcurrent,now});
  if(!assessment.ok)return {ok:false,reason:assessment.refusal};
  const {rows:own}=await client.query<{cost_reserved_usd:string|null}>(
    'select cost_reserved_usd from public.collection_requests where id=$1',[requestId],
  );
  const previous=usdToMicros(own[0]?.cost_reserved_usd);
  // Old queued rows may already have a hold. Preserve their authorized ceiling and all other history.
  const ceiling=previous!==null&&previous>0n&&previous<assessment.runCeilingMicros
    ?previous:assessment.runCeilingMicros;
  const reservedUsd=microsToUsd(ceiling);
  await client.query(
    "update public.collection_requests set cost_status='reserved',cost_reserved_usd=$2,updated_at=now() where id=$1 and status='queued'",
    [requestId,reservedUsd],
  );
  return {ok:true,reservedUsd};
}
