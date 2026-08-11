import { db } from '../config/db';

/**
 * Recalculate exact total distance and milestone timestamp for a user
 * Guarantees 100% data consistency across all legit activities.
 */
/**
 * Helper to recalculate exact total distance and milestone timestamp for a user using an existing Prisma transaction context.
 */
export async function recalculateUserStatsTx(tx: any, userId: string): Promise<{
  nickName: string;
  totalDistanceMeters: number;
  totalDistanceKm: number;
  reachedTargetAt: Date | null;
}> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      activities: {
        where: { isLegit: true },
        orderBy: { startDate: 'asc' }
      }
    }
  });

  if (!user) {
    throw new Error(`User with ID ${userId} not found.`);
  }

  // 1. Calculate sum of distance from legit activities
  let totalMeters = 0;
  let reachedTargetAt: Date | null = null;
  const targetMeters = user.gender === 'FEMALE' ? 15000 : 30000;

  for (const act of user.activities) {
    totalMeters += act.distance;
    if (totalMeters >= targetMeters && !reachedTargetAt) {
      reachedTargetAt = act.startDate;
    }
  }

  // 2. Update user in database
  const updatedUser = await tx.user.update({
    where: { id: userId },
    data: {
      totalDistance: totalMeters,
      reachedTargetAt: reachedTargetAt
    }
  });

  return {
    nickName: updatedUser.nickName,
    totalDistanceMeters: updatedUser.totalDistance,
    totalDistanceKm: Number((updatedUser.totalDistance / 1000).toFixed(2)),
    reachedTargetAt: updatedUser.reachedTargetAt
  };
}

/**
 * Recalculate exact total distance and milestone timestamp for a user
 * Guarantees 100% data consistency across all legit activities.
 */
export async function recalculateUserStats(userId: string) {
  return await db.$transaction(async (tx) => {
    return await recalculateUserStatsTx(tx, userId);
  });
}

/**
 * Admin Override: Manually set an activity's legit status (true or false)
 * Safely updates Activity and recalculates User's total distance atomically.
 */
export async function overrideActivityStatus(
  stravaActivityId: bigint | string,
  isLegit: boolean,
  reason?: string
): Promise<{
  activityId: string;
  stravaActivityId: string;
  userName: string;
  isLegit: boolean;
  newTotalKm: number;
  reason: string;
}> {
  const activityIdBigInt = BigInt(stravaActivityId);

  return await db.$transaction(async (tx) => {
    const existingActivity = await tx.activity.findUnique({
      where: { stravaActivityId: activityIdBigInt },
      include: { user: true }
    });

    if (!existingActivity) {
      throw new Error(`Activity with Strava ID ${stravaActivityId} not found in database.`);
    }

    const flagReason = isLegit 
      ? (reason || '[BTC] Duyệt thủ công bởi Ban Tổ Chức')
      : (reason ? `[BTC] ${reason}` : '[BTC] Bị từ chối / Hủy thủ công bởi Ban Tổ Chức');

    // 1. Update activity status
    await tx.activity.update({
      where: { id: existingActivity.id },
      data: {
        isLegit,
        flagReason
      }
    });

    // 2. Recalculate user stats atomically inside the same transaction
    const stats = await recalculateUserStatsTx(tx, existingActivity.userId);

    return {
      activityId: existingActivity.id,
      stravaActivityId: String(existingActivity.stravaActivityId),
      userName: stats.nickName,
      isLegit,
      newTotalKm: stats.totalDistanceKm,
      reason: flagReason
    };
  });
}
