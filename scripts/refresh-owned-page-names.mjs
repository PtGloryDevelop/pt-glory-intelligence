import pg from 'pg';
import {readOwnedPageNames} from './owned-page-names.mjs';

// Update display names in the latest derived snapshot only. Never sync ads,
// change financial fields, Page identity/UNIT assignments, or write to Management.
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
let connected=false,locked=false;
try{
 await db.connect();connected=true;
 const actor=process.argv[2]??null;
 if(actor){const role=(await db.query('select role from user_roles where user_id=$1',[actor])).rows[0]?.role;if(!['admin','analyst'].includes(role))throw Error('Analyst authorization required')}
 locked=(await db.query("select pg_try_advisory_lock(hashtext('owned_library_sync')) ok")).rows[0].ok;
 if(!locked)throw Error('Owned library sync is running');
 const {names,report}=await readOwnedPageNames();
 await db.query('begin');
 const snapshot=(await db.query("select id from owned_library_syncs where status='completed' order by finished_at desc limit 1 for update")).rows[0];
 if(!snapshot)throw Error('Completed snapshot required');
 const mappings=JSON.stringify([...names].map(([id,name])=>({id,name})));
 const daily=await db.query(`update owned_library_daily d set page_name=n.name
  from jsonb_to_recordset($2::jsonb) n(id text,name text)
  where d.sync_id=$1 and d.page_id=n.id and d.page_name is distinct from n.name`,[snapshot.id,mappings]);
 const ads=await db.query(`update owned_library_ads a set page_name=n.name,data=jsonb_set(a.data,'{page_name}',to_jsonb(n.name))
  from jsonb_to_recordset($2::jsonb) n(id text,name text)
  where a.sync_id=$1 and a.data->>'page_id'=n.id and (a.page_name is distinct from n.name or a.data->>'page_name' is distinct from n.name)`,[snapshot.id,mappings]);
 if(daily.rowCount||ads.rowCount)await db.query("insert into audit_logs(actor,action,entity_type,entity_id,after) values($1,'owned_library.page_names_refreshed','owned_library_sync',$2,$3::jsonb)",[actor,snapshot.id,JSON.stringify({...report,dailyRows:daily.rowCount,adRows:ads.rowCount})]);
 await db.query('commit');console.log(JSON.stringify({...report,dailyRowsUpdated:daily.rowCount,adRowsUpdated:ads.rowCount}));
}catch(error){if(connected)await db.query('rollback').catch(()=>{});console.error('Owned page-name refresh failed',error.constructor.name);process.exitCode=1}
finally{if(locked)await db.query("select pg_advisory_unlock(hashtext('owned_library_sync'))").catch(()=>{});await db.end()}
