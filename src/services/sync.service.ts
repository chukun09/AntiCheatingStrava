import axios from 'axios';
import { db } from '../config/db';
import { env } from '../config/env';
import { getValidAccessToken } from './strava.service';
import { processActivityQueueItem } from './activity.service';
import { notifyActivityDeletedBatch } from './telegram.service';

// Contest start timestamp: 00:00 03/08/2026
const CONTEST_START = new Date('2026-08-03T00:00:00+07:00');

// Helper to delay execution (prevents hitting Strava 100 req/15min rate limits)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sync all past running activities for a specific user since contest start date.
 * Features FULL BATCH RECONCILIATION:
 * 1. Fetches active activities from Strava API v3.
 * 2. Identifies & batch cleans up any deleted activities in DB (orphaned activities).
 * 3. Atomic DB transaction for batch deletions & totalDistance recalculation.
 * 4. Throttled execution to prevent Strava rate limits.
 */
export async function syncUserPastActivities(userId: string): Promise<{ syncedCount: number; deletedCount: number; totalFetched: number }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.stravaAthleteId) {
    console.warn(`[Historical Sync] User ${userId} has no Strava Athlete ID. Skipped.`);
    return { syncedCount: 0, deletedCount: 0, totalFetched: 0 };
  }

  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    console.error(`[Historical Sync] Cannot get valid access token for user ${user.nickName}. Aborted.`);
    return { syncedCount: 0, deletedCount: 0, totalFetched: 0 };
  }

  const contestStart = env.ALLOW_TEST_DATE ? new Date('2026-07-01T00:00:00+07:00') : CONTEST_START;
  const afterEpochSec = Math.floor(contestStart.getTime() / 1000);

  try {
    // 1. Fetch active athlete activities from Strava API
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterEpochSec}&per_page=200`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const stravaActivities: any[] = response.data || [];
    console.log(`[Historical Sync] Fetched ${stravaActivities.length} active activities from Strava for ${user.nickName}.`);

    const stravaActiveIds = new Set<string>(stravaActivities.map((a: any) => String(a.id)));

    // 2. Fetch all DB activities for this user since contestStart in 1 single query
    const dbActivities = await db.activity.findMany({
      where: {
        userId: user.id,
        startDate: { gte: contestStart }
      }
    });

    // 3. High-Performance In-Memory Reconciliation: Find orphaned activities in DB
    const deletedDbActivities = dbActivities.filter(a => !stravaActiveIds.has(String(a.stravaActivityId)));

    let deletedCount = 0;
    if (deletedDbActivities.length > 0) {
      console.log(`[Historical Sync] Found ${deletedDbActivities.length} deleted activities in DB for ${user.nickName}. Cleaning up batch...`);
      
      const targetDistanceMeters = user.gender === 'FEMALE' ? 15000 : 30000;
      let totalDeletedMeters = 0;
      const deletedDbIds = deletedDbActivities.map(a => a.id);

      deletedDbActivities.forEach(a => {
        if (a.isLegit) {
          totalDeletedMeters += a.distance;
        }
      });

      let newTotalKm = user.totalDistance / 1000;

      // Single Atomic Batch Transaction
      await db.$transaction(async (tx) => {
        if (totalDeletedMeters > 0) {
          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: { totalDistance: { decrement: totalDeletedMeters } }
          });
          newTotalKm = updatedUser.totalDistance / 1000;

          if (updatedUser.totalDistance < targetDistanceMeters && updatedUser.reachedTargetAt !== null) {
            await tx.user.update({
              where: { id: user.id },
              data: { reachedTargetAt: null }
            });
          }
        }

        await tx.activity.deleteMany({
          where: { id: { in: deletedDbIds } }
        });
      });

      deletedCount = deletedDbActivities.length;

      // Send 1 summary Telegram alert for batch cleanup
      await notifyActivityDeletedBatch({
        nickName: user.nickName,
        fullName: user.fullName,
        deletedCount: deletedDbActivities.length,
        deletedKm: totalDeletedMeters / 1000,
        newTotalKm
      });
    }

    // 4. Process active activities
    let syncedCount = 0;
    for (const activity of stravaActivities) {
      await processActivityQueueItem(activity.id, user.stravaAthleteId, 'create');
      syncedCount++;

      // Throttle 250ms to keep rate limits safe
      await sleep(250);
    }

    return { syncedCount, deletedCount, totalFetched: stravaActivities.length };
  } catch (error: any) {
    console.error(`[Historical Sync] Error syncing activities for ${user.nickName}:`, error?.response?.data || error.message);
    return { syncedCount: 0, deletedCount: 0, totalFetched: 0 };
  }
}

/**
 * Sync past activities for ALL onboarded users in DB with batching & throttling
 */
export async function syncAllUsersPastActivities(): Promise<{ totalUsers: number; totalSynced: number; totalDeleted: number }> {
  const users = await db.user.findMany({
    where: { stravaAthleteId: { not: null } }
  });

  console.log(`[Historical Sync] Starting throttled batch sync for ALL ${users.length} users...`);
  let totalSynced = 0;
  let totalDeleted = 0;

  for (const user of users) {
    const res = await syncUserPastActivities(user.id);
    totalSynced += res.syncedCount;
    totalDeleted += res.deletedCount;

    // Safety pause 500ms between users
    await sleep(500);
  }

  console.log(`[Historical Sync] Finished batch sync for ALL users. Synced: ${totalSynced}, Deleted Cleanup: ${totalDeleted}`);
  return { totalUsers: users.length, totalSynced, totalDeleted };
}
