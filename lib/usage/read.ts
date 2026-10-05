import 'server-only';
import type {Actor} from '../auth/role-model.ts';
import {readCollectorUsage} from '../collect/admin.ts';
import {aiUsage} from '../ai/compare.ts';
import type {Usage} from './shared.ts';

/** The provider's own account figure: counts every run, including ones no longer in our database. */
async function apifyAccount(): Promise<Usage['collect']['account']> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch('https://api.apify.com/v2/users/me/limits', {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(8000), cache: 'no-store'});
    if (!response.ok) return null;
    const {data} = await response.json();
    const used = Number(data?.current?.monthlyUsageUsd), limit = Number(data?.limits?.maxMonthlyUsageUsd);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
    return {usedUsd: used, limitUsd: limit, cycleStart: data.monthlyUsageCycle?.startAt ?? null, cycleEnd: data.monthlyUsageCycle?.endAt ?? null};
  } catch { return null; }
}

export async function readUsage(actor: Actor): Promise<Usage> {
  // Analysts see the same read-only totals the admin cost page shows; settings stay admin-only.
  const [collector, account, ai] = await Promise.all([
    readCollectorUsage({...actor, role: 'admin'}).catch(() => null),
    apifyAccount(),
    aiUsage().catch(() => null),
  ]);
  return {
    collect: {
      account,
      budgetUsd: collector?.monthlyBudgetUsd != null ? Number(collector.monthlyBudgetUsd) : null,
      finalUsd: collector ? Number(collector.finalizedActualCostUsd) : null,
      heldUsd: collector ? Number(collector.heldReservationUsd) : null,
      windowEnd: collector?.window?.end ?? null,
    },
    ai: ai && {usedUsd: ai.total, todayUsd: ai.today, dailyCapUsd: ai.dailyCap, stopAtUsd: ai.totalCap, creditUsd: ai.creditUsd, model: ai.model},
  };
}
