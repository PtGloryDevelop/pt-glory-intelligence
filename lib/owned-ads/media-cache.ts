export type OwnedMedia={account_id:string;ad_id:string;url:string|null;video_id?:string|null;video_url?:string|null;video_preview_url?:string|null};
// ponytail: process-local, 1,000 entries; durable storage if restart reuse matters.
export const ownedMediaCache=new Map<string,{until:number;media:OwnedMedia}>();
export const ownedMediaKey=(row:{account_id:string;ad_id:string})=>`${row.account_id}:${row.ad_id}`;
export function cachedOwnedImage(row:{account_id:string;ad_id:string;creative_url?:string|null}){
  const cached=ownedMediaCache.get(ownedMediaKey(row));
  return cached&&cached.until>Date.now()?cached.media.url??row.creative_url:row.creative_url;
}
