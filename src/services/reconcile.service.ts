import { db } from '../config/db';

export interface ReconcileDiff {
  userId: string;
  nickName: string;
  gender: string;
  dbTotalKm: number;
  calculatedLegitKm: number;
  driftKm: number;
  oldReachedTargetAt: Date | null;
  newReachedTargetAt: Date | null;
}

export interface ReconcileResult {
  checkedCount: number;
  fixedCount: number;
  totalDriftKm: number;
  diffs: ReconcileDiff[];
}

/**
 * Reconcile User.totalDistance and User.reachedTargetAt against the sum of legit activities in Activity table.
 * If dryRun = true (default), calculates drift and returns report without writing to DB.
 */
export async function reconcileAllUsers(options?: { dryRun?: boolean }): Promise<ReconcileResult> {
  const isDryRun = options?.dryRun !== false; // Default to true for safety

  const users = await db.user.findMany({
    select: {
      id: true,
      nickName: true,
      gender: true,
      totalDistance: true,
      reachedTargetAt: true
    }
  });

  const diffs: ReconcileDiff[] = [];
  let totalDriftKm = 0;
  let fixedCount = 0;

  // Process in batches of 50 users to stay light on RAM & DB
  const BATCH_SIZE = 50;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const userBatch = users.slice(i, i + BATCH_SIZE);
    const userIds = userBatch.map(u => u.id);

    // Fetch all legit activities for this user batch sorted by startDate
    const activities = await db.activity.findMany({
      where: {
        userId: { in: userIds },
        isLegit: true
      },
      select: {
        userId: true,
        distance: true,
        startDate: true
      },
      orderBy: { startDate: 'asc' }
    });

    // Map activities per user
    const userActsMap = new Map<string, typeof activities>();
    activities.forEach(act => {
      if (!userActsMap.has(act.userId)) {
        userActsMap.set(act.userId, []);
      }
      userActsMap.get(act.userId)!.push(act);
    });

    for (const user of userBatch) {
      const targetMeters = user.gender === 'FEMALE' ? 15000 : 30000;
      const userActs = userActsMap.get(user.id) || [];

      let calcTotalMeters = 0;
      let calcReachedTargetAt: Date | null = null;

      for (const act of userActs) {
        calcTotalMeters += act.distance;
        if (calcTotalMeters >= targetMeters && !calcReachedTargetAt) {
          calcReachedTargetAt = act.startDate;
        }
      }

      const dbTotalKm = user.totalDistance / 1000;
      const calculatedLegitKm = calcTotalMeters / 1000;
      const driftKm = Math.abs(calculatedLegitKm - dbTotalKm);

      const targetAtChanged = 
        (user.reachedTargetAt === null && calcReachedTargetAt !== null) ||
        (user.reachedTargetAt !== null && calcReachedTargetAt === null) ||
        (user.reachedTargetAt && calcReachedTargetAt && user.reachedTargetAt.getTime() !== calcReachedTargetAt.getTime());

      if (driftKm > 1e-4 || targetAtChanged) {
        diffs.push({
          userId: user.id,
          nickName: user.nickName,
          gender: user.gender,
          dbTotalKm: Number(dbTotalKm.toFixed(2)),
          calculatedLegitKm: Number(calculatedLegitKm.toFixed(2)),
          driftKm: Number(driftKm.toFixed(2)),
          oldReachedTargetAt: user.reachedTargetAt,
          newReachedTargetAt: calcReachedTargetAt
        });

        totalDriftKm += driftKm;

        if (!isDryRun) {
          await db.user.update({
            where: { id: user.id },
            data: {
              totalDistance: calcTotalMeters,
              reachedTargetAt: calcReachedTargetAt
            }
          });
          fixedCount++;
        }
      }
    }
  }

  return {
    checkedCount: users.length,
    fixedCount,
    totalDriftKm: Number(totalDriftKm.toFixed(2)),
    diffs
  };
}
