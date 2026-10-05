import {seriesSegments,type ReviewSeries} from '@/lib/dashboard/series';
export function DashboardSparkline({series,label}:{series:ReviewSeries|undefined;label:string}){
 const paths=seriesSegments(series?.points.map(point=>point.value)??[]);
 if(!paths.length)return <span title="ยังไม่มีข้อมูลรายวันสำหรับกราฟ">—</span>;
 const missing=series!.points.some(point=>point.value==null);
 const description=series!.points.map(point=>`${point.date}: ${point.value??'ไม่มีข้อมูล'}`).join(', ');
 return <svg viewBox="0 0 120 32" width="88" height="28" preserveAspectRatio="none" role="img" aria-label={`${label}${missing?' · มีวันที่ไม่มีข้อมูล':''}`}><title>{description}</title>{paths.map((points,index)=>{const first=points.split(' ')[0].split(',');return points.includes(' ')?<polyline key={index} points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>:<circle key={index} cx={first[0]} cy={first[1]} r="2.5" fill="currentColor"/>;})}</svg>;
}
