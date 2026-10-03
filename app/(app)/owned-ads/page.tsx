import { forbidden } from "next/navigation";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { LegacyOwnedReports } from "./owned-client";
import { CompanyLibrary } from "./company-library";
import { parseOwnedLibraryQuery } from "@/lib/owned-ads/library-query";

export const dynamic = "force-dynamic";

export default async function OwnedAdsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();
  const params=await searchParams;
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params)){
    const first=Array.isArray(value)?value[0]:value;
    if(first!==undefined)query.set(key,first);
  }
  return <><CompanyLibrary initialFilters={parseOwnedLibraryQuery(query)} /><LegacyOwnedReports /></>;
}
