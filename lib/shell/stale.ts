/**
 * When each side counts as late. The sidebar's amber box and the overview's warning read this one rule,
 * so they cannot disagree about the same data.
 */
const DAY=86_400_000;

// ponytail: 2 days = yesterday's import missing; tune if the daily job moves.
export const OWNED_LATE_DAYS=2;
export const RIVALS_LATE_DAYS=7;

/** `through` is the last Bangkok date with owned figures; it is late once that day ended more than two days ago. */
export const ownedLate=(through:string,now:number)=>(now-Date.parse(`${through}T23:59:59+07:00`))/DAY>OWNED_LATE_DAYS;
/** `collectedAt` is when the newest rival collection ran. */
export const rivalsLate=(collectedAt:string,now:number)=>(now-Date.parse(collectedAt))/DAY>RIVALS_LATE_DAYS;

/** Whole calendar days in Bangkok between a date (YYYY-MM-DD or a timestamp) and now, for saying how old it is. */
export function daysBehind(value:string,now:number):number{
  const bangkokDay=(time:number)=>Date.parse(new Date(time+7*3_600_000).toISOString().slice(0,10));
  const then=value.length===10?Date.parse(value):bangkokDay(Date.parse(value));
  return Math.max(0,Math.round((bangkokDay(now)-then)/DAY));
}
