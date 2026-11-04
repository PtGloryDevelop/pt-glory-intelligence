import {LoadingSkeleton} from '@/components/states/LoadingSkeleton';

/** The board and the library read several sources before they can answer, so the page shows itself first. */
export default function Loading(){
 return <LoadingSkeleton rows={6}/>;
}
