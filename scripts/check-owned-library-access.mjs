import assert from "node:assert/strict";
import pg from "pg";

const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query("begin read only");
  const users=(await client.query("select user_id,role from user_roles where role in ('analyst','viewer')")).rows;
  assert.ok(users.some(user=>user.role==='analyst') && users.some(user=>user.role==='viewer'));
  const staged=(await client.query("select id from owned_library_syncs where status='running' limit 1")).rows[0];
  const completed=(await client.query("select id from owned_library_syncs where status='completed' limit 1")).rows[0];
  for(const user of users){
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user.user_id,role:'authenticated'})]);
    const visible=(await client.query("select id from owned_library_syncs limit 1")).rowCount;
    assert.equal(visible,user.role==='analyst'?1:0);
    await client.query("savepoint rpc_access");
    if(user.role==='viewer')await assert.rejects(client.query("select owned_library_filtered_page($1,'','','',0)",[completed.id]),{code:'42501'});
    else assert.equal((await client.query("select owned_library_filtered_page($1,'','','',0) as page",[completed.id])).rows[0].page.rows.length,24);
    await client.query("rollback to savepoint rpc_access");
    if(user.role==='viewer')assert.equal((await client.query("select ad_id from owned_library_ads limit 1")).rowCount,0);
    if(staged)assert.equal((await client.query("select ad_id from owned_library_ads where sync_id=$1 limit 1",[staged.id])).rowCount,0);
    assert.equal((await client.query("select has_table_privilege('authenticated','public.owned_library_ads','INSERT') as writable")).rows[0].writable,false);
    await client.query("reset role");
  }
  console.log(`Owned library RLS: viewer blocked, analyst allowed, direct writes blocked${staged?', staging hidden':''}`);
}catch(error){console.error("Owned library access check failed",error.code ?? error.name);process.exitCode=1;}
finally{await client.query("rollback");await client.end();}
