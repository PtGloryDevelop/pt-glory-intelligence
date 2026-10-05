export type Usage = {
  collect: {
    account: {usedUsd: number; limitUsd: number; cycleStart: string | null; cycleEnd: string | null} | null;
    budgetUsd: number | null;
    /** Settled provider cost this window. */
    finalUsd: number | null;
    /** Still held for runs whose cost has not settled (a hold, not a charge). */
    heldUsd: number | null;
    windowEnd: string | null;
  };
  ai: {usedUsd: number; todayUsd: number; dailyCapUsd: number; stopAtUsd: number; creditUsd: number; model: string} | null;
};
