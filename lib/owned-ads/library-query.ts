export const OWNED_LIBRARY_STATUSES = [
  ["ACTIVE", "กำลังแสดง"], ["PAUSED", "หยุดแอด"], ["CAMPAIGN_PAUSED", "หยุดแคมเปญ"],
  ["ADSET_PAUSED", "หยุดชุดแอด"], ["ARCHIVED", "เก็บถาวร"], ["DELETED", "ลบแล้ว"],
  ["DISAPPROVED", "ไม่ผ่านการอนุมัติ"],
] as const;

export type OwnedLibraryFilters = { search: string; account: string; status: string; page: number; hasSpend: boolean };

export function parseOwnedLibraryQuery(query: URLSearchParams): OwnedLibraryFilters {
  const account = query.get("account") ?? "";
  const status = query.get("status") ?? "";
  const page = Number(query.get("page") ?? 0);
  return {
    search: (query.get("q") ?? "").slice(0, 160),
    account: account.length <= 128 ? account : "",
    status: OWNED_LIBRARY_STATUSES.some(([value]) => value === status) ? status : "",
    page: Number.isSafeInteger(page) && page >= 0 && page <= 100000 ? page : 0,
    hasSpend: query.get("spend") !== "all",
  };
}
