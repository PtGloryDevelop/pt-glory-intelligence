import {unstable_cache} from 'next/cache';
import {shortCache} from './short-cache.ts';

/**
 * Keeps an answer where every server instance finds it, and across deploys, so a new instance does not make its first
 * visitor wait. Past `seconds` the kept answer is still returned once while a new one is read behind it, so anything
 * that must change at once belongs in the key. `read` may not call cookies(): open the client before calling this.
 * The short cache in front only lets views asking at the same moment share one lookup.
 */
export function sharedCache<T>(name:string,seconds:number){
  const sameMoment=shortCache<T>(60_000,200);
  return (key:string,read:()=>Promise<T>):Promise<T>=>sameMoment(key,()=>unstable_cache(read,[name,key],{revalidate:seconds})());
}
