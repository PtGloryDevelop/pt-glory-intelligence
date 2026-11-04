/**
 * Keeps an answer for a while per server instance, for reads every signed-in person gets the same answer to.
 * The promise is kept, so views asking at the same moment share one read; a failed read is forgotten.
 */
export function shortCache<T>(ttlMs:number,maxEntries:number,now:()=>number=Date.now){
  const entries=new Map<string,{until:number;value:Promise<T>}>();
  return (key:string,read:()=>Promise<T>):Promise<T>=>{
    const hit=entries.get(key);
    if(hit&&hit.until>now())return hit.value;
    if(entries.size>=maxEntries)entries.clear();
    const value=read();
    entries.set(key,{until:now()+ttlMs,value});
    value.catch(()=>{if(entries.get(key)?.value===value)entries.delete(key);});
    return value;
  };
}
