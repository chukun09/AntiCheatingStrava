import { db } from '../config/db';
import { getValidAccessToken, fetchStravaActivityDetail } from './strava.service';
import { validateActivity } from './anticheat.service';
import { notifyReachedMilestone, notifyCheatingAlert } from './telegram.service';

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

  const existingActivity = await db.activity.findUnique({
    where: { stravaActivityId: stravaActivityIdBigInt }
  });

  const targetDistanceMeters = user.gender === 'FEMALE' ? 15000 : 30000;

  // ----------------------------------------------------
  // CASE A: ASPECT TYPE = 'DELETE'
  // ----------------------------------------------------
  if (aspectType === 'delete') {
    if (!existingActivity) {
      console.log(`[Queue Worker] Activity ${activityId} to delete was not found in DB. Skipping.`);
      return;
    }

    console.log(`[Queue Worker] Deleting activity ${activityId} for ${user.nickName}...`);
    await db.$transaction(async (tx) => {
      if (existingActivity.isLegit) {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            totalDistance: { decrement: existingActivity.distance }
          }
        });

        // Reset milestone if totalDistance falls below target
        if (updatedUser.totalDistance < targetDistanceMeters && updatedUser.reachedTargetAt !== null) {
          await tx.user.update({
            where: { id: user.id },
            data: { reachedTargetAt: null }
          });
        }
      }

      await tx.activity.delete({
        where: { id: existingActivity.id }
      });
    });

    console.log(`[Queue Worker] Deleted activity ${activityId} successfully.`);
    return;
  }

  // ----------------------------------------------------
  // CASE B: ASPECT TYPE = 'CREATE' OR 'UPDATE'
  // ----------------------------------------------------
  if (aspectType === 'create' && existingActivity) {
    console.log(`[Queue Worker] Activity ${activityId} already exists in DB for 'create'. Skipping.`);
    return;
  }

  // Get valid access token
  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    console.error(`[Queue Worker] Unable to get valid access token for user ${user.nickName}. Aborting.`);
    return;
  }

  // Fetch activity detail from Strava
  let activityData: any;
  try {
    activityData = await fetchStravaActivityDetail(activityId, accessToken);
  } catch (error) {
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

  // Atomic DB Transaction
  await db.$transaction(async (tx) => {
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
          startDate: new Date(activityData.start_date || Date.now())
        }
      });

      if (netDiffMeters !== 0) {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { totalDistance: { increment: netDiffMeters } }
        });

        if (updatedUser.totalDistance >= targetDistanceMeters && updatedUser.reachedTargetAt === null) {
          reachedAtDate = new Date();
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
          startDate: new Date(activityData.start_date || Date.now())
        }
      });

      if (validation.isLegit) {
        const addedMeters = activityData.distance || 0;
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { totalDistance: { increment: addedMeters } }
        });

        if (updatedUser.totalDistance >= targetDistanceMeters && updatedUser.reachedTargetAt === null) {
          reachedAtDate = new Date();
          isNewWinner = true;
          await tx.user.update({
            where: { id: user.id },
            data: { reachedTargetAt: reachedAtDate }
          });
        }
      }
    }
  });

  // Telegram Notifications
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
  } else if (aspectType === 'create') {
    await notifyCheatingAlert({
      nickName: user.nickName,
      fullName: user.fullName,
      activityName: activityData.name || 'Bài chạy không hợp lệ',
      reason: validation.reason || 'Vi phạm quy định giải chạy IRIS',
      stravaActivityId: activityId
    });
  }
}
