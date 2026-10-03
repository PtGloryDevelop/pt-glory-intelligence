import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {ownedPageName} from '../lib/owned-ads/page-names.ts';

// Same local source bridge as the owned-media worker. No source or Meta writes.
export async function readOwnedPageNames() {
 const sourcePath=process.env.OWNED_MANAGEMENT_PROJECT_PATH;
 const email=process.env.OWNED_MANAGEMENT_AUTHORIZED_EMAIL;
 if(!sourcePath||!email)throw Error('Source configuration unavailable');
 const env=parseEnv(await readFile(resolve(sourcePath,'.env.local'),'utf8'));
 const db=createClient(env.SUPABASE_URL??env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const member=await db.from('workspace_members').select('role,status').eq('normalized_email',email).single();
 if(member.error||member.data?.role!=='admin'||member.data?.status!=='active')throw Error('Source authorization required');
 const config=await db.from('workspace_config').select('primary_connection_id').eq('singleton',true).single();
 if(config.error)throw Error('Source configuration unavailable');
 const accounts=await db.from('meta_ad_accounts').select('id').eq('connection_id',config.data.primary_connection_id).eq('is_selected',true);
 if(accounts.error||!accounts.data.length)throw Error('Selected source accounts unavailable');
 const directory=await db.from('meta_account_page_directory').select('page_id,page_name').in('ad_account_id',accounts.data.map(a=>a.id));
 if(directory.error||directory.data.length>=1000)throw Error('Source page directory incomplete');
 const names=new Map();const ids=new Set();
 for(const page of directory.data){
  if(!/^\d{1,32}$/.test(page.page_id??''))throw Error('Invalid source page identity');
  ids.add(page.page_id);const name=ownedPageName(page.page_id,page.page_name);if(name)names.set(page.page_id,name);
 }
 if(ids.size>500)throw Error('Page-name read exceeds local bridge limit');
 let token;
 const tokenFile=process.env.OWNED_MANAGEMENT_ACCESS_TOKEN_FILE??resolve(sourcePath,'Token Facebook.txt');
 try{
  const matches=[...new Set((await readFile(tokenFile,'utf8')).match(/EAA[A-Za-z0-9]+/g)??[])];
  if(matches.length!==1||matches[0].length<50)throw Error('Invalid token file');token=matches[0];
 }catch(error){if(error.code!=='ENOENT'||process.env.OWNED_MANAGEMENT_ACCESS_TOKEN_FILE)throw error}
 if(!token){
  const connection=await db.from('meta_connections').select('token_ciphertext').eq('id',config.data.primary_connection_id).eq('status','active').single();
  if(connection.error)throw Error('Source connection unavailable');
  const keyEnv=process.env.OWNED_MANAGEMENT_TOKEN_ENV_PATH?parseEnv(await readFile(process.env.OWNED_MANAGEMENT_TOKEN_ENV_PATH,'utf8')):env;
  process.env.TOKEN_ENCRYPTION_KEY=keyEnv.TOKEN_ENCRYPTION_KEY;
  const {decryptToken}=await import(pathToFileURL(resolve(sourcePath,'src/lib/secret-crypto.ts')).href);token=decryptToken(connection.data.token_ciphertext);
 }
 const failures={};const missing=[...ids].filter(id=>!names.has(id));
 const read=async id=>{
  try{
   const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION||'v25.0'}/${id}`);url.searchParams.set('fields','id,name');
   const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(6000)});
   const body=await response.json();const name=ownedPageName(id,body.name);
   if(response.ok&&body.id===id&&name)names.set(id,name);
   else {const code=String(body.error?.code??response.status);failures[code]=(failures[code]??0)+1;}
  }catch{failures.network=(failures.network??0)+1;}
 };
 for(let offset=0;offset<missing.length;offset+=4)await Promise.all(missing.slice(offset,offset+4).map(read));
 return {names,report:{pages:ids.size,named:names.size,unresolved:ids.size-names.size,failures}};
}
