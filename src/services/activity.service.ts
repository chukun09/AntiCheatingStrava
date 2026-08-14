import { db } from '../config/db';
import { getValidAccessToken, fetchStravaActivityDetail } from './strava.service';
import { validateActivity } from './anticheat.service';
import { notifyReachedMilestone, notifyCheatingAlert, notifyActivityDeleted, notifyActivityUpdated } from './telegram.service';
import { WEEKS } from './awards.service';

/**
 * Worker function executed by P-Queue to process a Strava activity event (create, update, or delete)
 */
export async function processActivityQueueItem(
  activityId: bigint | string,
  athleteId: bigint | string,
  aspectType: 'create' | 'update' | 'delete' = 'create'
): Promise<void> {
  const stravaActivityIdBigInt = BigInt(activityId);
  const stravaAthleteIdBigInt = BigInt(athleteId);

  console.log(`[Queue Worker] Processing activityId=${activityId} for athleteId=${athleteId} (aspectType=${aspectType})`);

  // 1. Find User by stravaAthleteId
  const user = await db.user.findUnique({
    where: { stravaAthleteId: stravaAthleteIdBigInt }
  });

  if (!user) {
    console.warn(`[Queue Worker] User with stravaAthleteId=${athleteId} not found in DB. Skipping.`);
    return;
  }

  const targetDistanceMeters = user.gender === 'FEMALE' ? 15000 : 30000;

  // ----------------------------------------------------
  // CASE A: ASPECT TYPE = 'DELETE'
  // ----------------------------------------------------
  if (aspectType === 'delete') {
    let deletedActivityName = 'Bài chạy';
    let deletedDistanceKm = 0;
    let newTotalKm = 0;
    let wasDeleted = false;

    await db.$transaction(async (tx) => {
      const existingActivity = await tx.activity.findUnique({
        where: { stravaActivityId: stravaActivityIdBigInt }
      });

      if (!existingActivity) {
        return;
      }

      wasDeleted = true;
      deletedActivityName = existingActivity.name;
      deletedDistanceKm = existingActivity.distance / 1000;

      if (existingActivity.isLegit) {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            totalDistance: { decrement: existingActivity.distance }
          }
        });
        newTotalKm = updatedUser.totalDistance / 1000;

        // Reset milestone if totalDistance falls below target
        if (updatedUser.totalDistance < targetDistanceMeters && updatedUser.reachedTargetAt !== null) {
          await tx.user.update({
            where: { id: user.id },
            data: { reachedTargetAt: null }
          });
        }
      } else {
        const currentUser = await tx.user.findUnique({ where: { id: user.id } });
        newTotalKm = (currentUser?.totalDistance || 0) / 1000;
      }

      await tx.activity.delete({
        where: { id: existingActivity.id }
      });
    });

    if (!wasDeleted) {
      console.log(`[Queue Worker] Activity ${activityId} to delete was not found in DB. Skipping.`);
      return;
    }

    console.log(`[Queue Worker] Deleted activity ${activityId} successfully.`);

    // Send Telegram alert to BTC group
    await notifyActivityDeleted({
      nickName: user.nickName,
      fullName: user.fullName,
      activityName: deletedActivityName,
      stravaActivityId: activityId,
      deletedKm: deletedDistanceKm,
      newTotalKm
    });

    return;
  }

  // ----------------------------------------------------
  // CASE B: ASPECT TYPE = 'CREATE' OR 'UPDATE'
  // ----------------------------------------------------

  // Get valid access token
  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    console.error(`[Queue Worker] Unable to get valid access token for user ${user.nickName}. Aborting.`);
    return;
  }

  // Fetch activity detail from Strava
  let activityData: any;
  try {
    activityData = await fetchStravaActivityDetail(activityId, accessToken, 0, user.appClientId);
  } catch (error: any) {
    if (error?.name === 'StravaDailyQuotaError') {
      console.warn(`[Queue Worker] Daily quota limit reached for App Client ${user.appClientId}. Skipping activity ${activityId} to free worker slot.`);
      return;
    }
    console.error(`[Queue Worker] Failed to fetch activity detail for ${activityId}. Aborting.`);
    return;
  }

  // Run Anti-Cheat Engine
  const validation = validateActivity(activityData);
  console.log(`[Anti-Cheat] Activity ${activityId} validation result for ${user.nickName}:`, validation);

  const distanceKm = (activityData.distance || 0) / 1000;
  const averagePaceSec = distanceKm > 0 ? (activityData.moving_time || 0) / distanceKm : 0;

  let isNewWinner = false;
  let reachedAtDate: Date | null = null;
  let isExisting = false;
  let oldDistanceKm = 0;

  let isCreateSkipped = false;

  // Atomic DB Transaction
  await db.$transaction(async (tx) => {
    const existingActivity = await tx.activity.findUnique({
      where: { stravaActivityId: stravaActivityIdBigInt }
    });

    isExisting = !!existingActivity;
    if (existingActivity) {
      oldDistanceKm = existingActivity.distance / 1000;
    }

    if (aspectType === 'create' && existingActivity) {
      console.log(`[Queue Worker] Activity ${activityId} already exists in DB for 'create'. Skipping.`);
      isCreateSkipped = true;
      return;
    }

    if (existingActivity) {
      // UPDATE EXISTING ACTIVITY
      const oldLegitMeters = existingActivity.isLegit ? existingActivity.distance : 0;
      const newLegitMeters = validation.isLegit ? (activityData.distance || 0) : 0;
      const netDiffMeters = newLegitMeters - oldLegitMeters;

      await tx.activity.update({
        where: { id: existingActivity.id },
        data: {
          name: activityData.name || 'Untitled Activity',
          distance: activityData.distance || 0,
          movingTime: activityData.moving_time || 0,
          elapsedTime: activityData.elapsed_time || 0,
          type: activityData.type || 'Run',
          averagePace: averagePaceSec,
          maxSpeed: activityData.max_speed || 0,
          manual: activityData.manual === true,
          hasHeartrate: activityData.has_heartrate === true,
          averageCadence: activityData.average_cadence || null,
          deviceName: activityData.device_name || null,
          externalId: activityData.external_id || null,
          isLegit: validation.isLegit,
          flagReason: validation.reason || null,
          startDate: new Date(activityData.start_date || activityData.start_date_local || Date.now())
        }
      });

      if (netDiffMeters !== 0) {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { totalDistance: { increment: netDiffMeters } }
        });

        if (updatedUser.totalDistance >= targetDistanceMeters && updatedUser.reachedTargetAt === null) {
          reachedAtDate = new Date(activityData.start_date || activityData.start_date_local || Date.now());
          isNewWinner = true;
          await tx.user.update({
            where: { id: user.id },
            data: { reachedTargetAt: reachedAtDate }
          });
        } else if (updatedUser.totalDistance < targetDistanceMeters && updatedUser.reachedTargetAt !== null) {
          await tx.user.update({
            where: { id: user.id },
            data: { reachedTargetAt: null }
          });
        }
      }
    } else {
      // CREATE NEW ACTIVITY
      await tx.activity.create({
        data: {
          stravaActivityId: stravaActivityIdBigInt,
          userId: user.id,
          name: activityData.name || 'Untitled Activity',
          distance: activityData.distance || 0,
          movingTime: activityData.moving_time || 0,
          elapsedTime: activityData.elapsed_time || 0,
          type: activityData.type || 'Run',
          averagePace: averagePaceSec,
          maxSpeed: activityData.max_speed || 0,
          manual: activityData.manual === true,
          hasHeartrate: activityData.has_heartrate === true,
          averageCadence: activityData.average_cadence || null,
          deviceName: activityData.device_name || null,
          externalId: activityData.external_id || null,
          isLegit: validation.isLegit,
          flagReason: validation.reason || null,
          startDate: new Date(activityData.start_date || activityData.start_date_local || Date.now())
        }
      });

      if (validation.isLegit) {
        const addedMeters = activityData.distance || 0;
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { totalDistance: { increment: addedMeters } }
        });

        if (updatedUser.totalDistance >= targetDistanceMeters && updatedUser.reachedTargetAt === null) {
          reachedAtDate = new Date(activityData.start_date || activityData.start_date_local || Date.now());
          isNewWinner = true;
          await tx.user.update({
            where: { id: user.id },
            data: { reachedTargetAt: reachedAtDate }
          });
        }
      }
    }
  });

  // Early return if creation was skipped because activity already exists in DB
  if (isCreateSkipped) {
    return;
  }

  // Telegram Notifications
  if (aspectType === 'update' && isExisting) {
    const updatedUser = await db.user.findUnique({ where: { id: user.id } });
    await notifyActivityUpdated({
      nickName: user.nickName,
      fullName: user.fullName,
      activityName: activityData.name || 'Bài chạy',
      stravaActivityId: activityId,
      oldKm: oldDistanceKm,
      newKm: (activityData.distance || 0) / 1000,
      newTotalKm: ((updatedUser?.totalDistance || 0) / 1000),
      isLegit: validation.isLegit
    });
  }

  if (validation.isLegit) {
    if (isNewWinner && reachedAtDate) {
      await notifyReachedMilestone({
        nickName: user.nickName,
        fullName: user.fullName,
        gender: user.gender,
        targetKm: targetDistanceMeters / 1000,
        reachedAt: reachedAtDate
      });
    }
  } else if (aspectType === 'create' && !isExisting) {
    await notifyCheatingAlert({
      nickName: user.nickName,
      fullName: user.fullName,
      activityName: activityData.name || 'Bài chạy không hợp lệ',
      reason: validation.reason || 'Vi phạm quy định giải chạy IRIS',
      stravaActivityId: activityId
    });
  }
}

export interface BestPaceQueryOptions {
  week?: number | string;
  limit?: number;
}

/**
 * Retrieves the top fastest (best pace) legit activities within a specific week or across the whole contest.
 */
export async function getBestPaceActivities(options?: BestPaceQueryOptions) {
  const limit = Math.min(Math.max(Number(options?.limit) || 10, 1), 100);

  let dateFilter: any = {};
  let weekTitle = 'Toàn bộ giải';
  let weekNumber: number | null = null;

  if (options?.week !== undefined && options?.week !== null && options?.week !== '') {
    const rawWeek = String(options.week).trim().toLowerCase().replace(/[\s_]+/g, '');
    const match = rawWeek.match(/\d+/);
    if (match) {
      const parsedWeek = parseInt(match[0], 10);
      if (parsedWeek >= 1 && parsedWeek <= 4) {
        weekNumber = parsedWeek;
        const weekObj = WEEKS[parsedWeek - 1];
        if (weekObj) {
          dateFilter = {
            startDate: {
              gte: weekObj.start,
              lt: weekObj.end
            }
          };
          weekTitle = weekObj.name;
        }
      }
    }
  }

  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      averagePace: { gt: 0 },
      ...dateFilter
    },
    include: {
      user: true
    },
    orderBy: {
      averagePace: 'asc' // Fastest pace (smallest seconds/km) first
    },
    take: limit
  });

  return {
    weekNumber,
    weekTitle,
    limit,
    activities
  };
}

