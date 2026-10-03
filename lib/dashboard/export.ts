import type {OwnedPerformancePeriod,OwnedPerformanceRow} from '../owned-ads/performance.ts';
const cell=(value:unknown)=>{
 const text=value==null?'':String(value);
 const safe=/^(?:\s*[=+\-@]|[\t\r\n])/.test(text)?`'${text}`:text;
 return `"${safe.replaceAll('"','""')}"`;
};
/** Exports only the visible authorized rows, with explicit dates and currency. */
export function reviewCsv(rows:OwnedPerformanceRow[],period:OwnedPerformancePeriod):string{
 const headers=['account_id','ad_id','ad_name','currency','date_start','date_end','spend','roas_meta','conversations','cost_per_conversation'];
 return '\uFEFF'+[headers,...rows.map(ad=>[ad.account_id,ad.ad_id,ad.ad_name,ad.currency,period.from,period.to,ad.spend,ad.spend&&ad.purchase_value!=null?ad.purchase_value/ad.spend:null,ad.conversations,ad.cost_per_conversation])].map(row=>row.map(cell).join(',')).join('\r\n');
}
