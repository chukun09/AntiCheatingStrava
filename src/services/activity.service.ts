import { db } from '../config/db';
import { getValidAccessToken, fetchStravaActivityDetail } from './strava.service';
import { validateActivity } from './anticheat.service';
import { notifyReachedMilestone, notifyCheatingAlert } from './telegram.service';

/**
 * Worker function executed by P-Queue to process a Strava activity event
 */
export async function processActivityQueueItem(activityId: bigint | string, athleteId: bigint | string): Promise<void> {
  const stravaActivityIdBigInt = BigInt(activityId);
  const stravaAthleteIdBigInt = BigInt(athleteId);

  console.log(`[Queue Worker] Processing activityId=${activityId} for athleteId=${athleteId}`);

  // 1. Find User by stravaAthleteId
  const user = await db.user.findUnique({
    where: { stravaAthleteId: stravaAthleteIdBigInt }
  });

  if (!user) {
    console.warn(`[Queue Worker] User with stravaAthleteId=${athleteId} not found in DB. Skipping.`);
    return;
  }

  // 2. Check for duplicate activity
  const existingActivity = await db.activity.findUnique({
    where: { stravaActivityId: stravaActivityIdBigInt }
  });

  if (existingActivity) {
    console.log(`[Queue Worker] Activity ${activityId} already exists in DB. Skipping.`);
    return;
  }

  // 3. Get valid access token
  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    console.error(`[Queue Worker] Unable to get valid access token for user ${user.nickName}. Aborting.`);
    return;
  }

  // 4. Fetch activity detail from Strava
  let activityData: any;
  try {
    activityData = await fetchStravaActivityDetail(activityId, accessToken);
  } catch (error) {
    console.error(`[Queue Worker] Failed to fetch activity detail for ${activityId}. Aborting.`);
    return;
  }

  // 5. Run Anti-Cheat Engine (Includes IRIS Date Window 03/08 - 30/08 & Pace < 4:00/km rule)
  const validation = validateActivity(activityData);
  console.log(`[Anti-Cheat] Activity ${activityId} validation result for ${user.nickName}:`, validation);

  // 6. Calculate Average Pace (seconds per km)
  const distanceKm = (activityData.distance || 0) / 1000;
  const averagePaceSec = distanceKm > 0 ? (activityData.moving_time || 0) / distanceKm : 0;

  let isNewWinner = false;
  let reachedAtDate: Date | null = null;

  // Gender target per IRIS Section VI (Male: 30km = 30,000m, Female: 15km = 15,000m)
  const targetDistanceMeters = user.gender === 'FEMALE' ? 15000 : 30000;

  // 7. Atomic DB Transaction
  await db.$transaction(async (tx) => {
    // Save Activity record
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

    // If legit run, update total distance atomically & check individual milestone
    if (validation.isLegit) {
      const addedMeters = activityData.distance || 0;

      // Atomic increment in PostgreSQL
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          totalDistance: { increment: addedMeters }
        }
      });

      // Check if user crossed target (Nam 30km / Nữ 15km) for the first time
      if (updatedUser.totalDistance >= targetDistanceMeters && updatedUser.reachedTargetAt === null) {
        reachedAtDate = new Date();
        isNewWinner = true;

        await tx.user.update({
          where: { id: user.id },
          data: {
            reachedTargetAt: reachedAtDate
          }
        });
      }
    }
  });

  // 8. Trigger Telegram Notifications
  if (validation.isLegit) {
    // Only send celebration when user reaches 30km (Male) / 15km (Female) target for the first time
    if (isNewWinner && reachedAtDate) {
      await notifyReachedMilestone({
        nickName: user.nickName,
        fullName: user.fullName,
        gender: user.gender,
        targetKm: targetDistanceMeters / 1000,
        reachedAt: reachedAtDate
      });
    }
  } else {
    // Send Anti-Cheat warning alert to Telegram BTC Group
    await notifyCheatingAlert({
      nickName: user.nickName,
      fullName: user.fullName,
      activityName: activityData.name || 'Bài chạy không hợp lệ',
      reason: validation.reason || 'Vi phạm quy định giải chạy IRIS',
      stravaActivityId: activityId
    });
  }
}
