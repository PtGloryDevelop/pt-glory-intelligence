import 'server-only';
import type {Actor} from '../auth/role-model.ts';
import {readCollectorUsage} from '../collect/admin.ts';
import {aiUsage} from '../ai/compare.ts';
import {readApifyAccountUsage} from '../collect/apify.ts';
import type {Usage} from './shared.ts';

export async function readUsage(actor: Actor): Promise<Usage> {
  // Analysts see the same read-only totals the admin cost page shows; settings stay admin-only.
  const [collector, account, ai] = await Promise.all([
    readCollectorUsage({...actor, role: 'admin'}).catch(() => null),
    readApifyAccountUsage(),
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
