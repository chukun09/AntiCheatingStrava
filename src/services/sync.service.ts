import { stravaHttp } from '../utils/http';
import { db } from '../config/db';
import { env } from '../config/env';
import { getValidAccessToken } from './strava.service';
import { processActivityQueueItem } from './activity.service';
import { notifyActivityDeletedBatch } from './telegram.service';
import { stravaRateLimiter } from '../utils/ratelimit';
import { isActivityQueued, markActivityQueued, unmarkActivityQueued } from '../utils/queue';

// Contest start timestamp: 00:00 03/08/2026
const CONTEST_START = new Date('2026-08-03T00:00:00+07:00');

// Helper to delay execution (prevents hitting Strava 100 req/15min rate limits)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sync all past running activities for a specific user since contest start date.
 * Features FULL BATCH RECONCILIATION:
 * 1. Fetches active activities from Strava API v3 with pagination.
 * 2. Identifies & batch cleans up any deleted activities in DB (orphaned activities) with Safety Guards.
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

  const stravaActivities: any[] = [];
  let fetchComplete = false;
  const MAX_PAGES = 10;

  try {
    // 1. Fetch active athlete activities from Strava API with pagination (per_page=200)
    for (let page = 1; page <= MAX_PAGES; page++) {
      const clientId = user.appClientId || 'default';
      await stravaRateLimiter.acquire(clientId);

      const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterEpochSec}&page=${page}&per_page=200`;
      const response = await stravaHttp.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const readUsage = response.headers['x-readratelimit-usage'] || response.headers['x-ratelimit-usage'];
      const readLimit = response.headers['x-readratelimit-limit'] || response.headers['x-ratelimit-limit'];
      stravaRateLimiter.updateFromHeaders(clientId, readUsage, readLimit);

      const pageItems: any[] = response.data || [];
      stravaActivities.push(...pageItems);

      if (pageItems.length < 200) {
        fetchComplete = true;
        break;
      }
    }

    console.log(`[Historical Sync] Fetched total ${stravaActivities.length} active activities from Strava for ${user.nickName} (fetchComplete=${fetchComplete}).`);

    const stravaActiveIds = new Set<string>(stravaActivities.map((a: any) => String(a.id)));

    // 2. Fetch all DB activities for this user since contestStart in 1 single query
    const dbActivities = await db.activity.findMany({
      where: {
        userId: user.id,
        startDate: { gte: contestStart }
      }
    });

    // 3. High-Performance In-Memory Reconciliation: Find orphaned activities in DB (excluding system bonus activities)
    const deletedDbActivities = dbActivities.filter(a => 
      !stravaActiveIds.has(String(a.stravaActivityId)) && 
      !String(a.stravaActivityId).startsWith('9999') &&
      !a.name.toLowerCase().includes('pickleball')
    );

    let deletedCount = 0;
    
    // Safety Guards before deletion:
    // - Must have completed fetching all pages without network/API error
    // - If Strava returned 0 items but DB has items, skip deletion (anomalous empty response guard)
    // - If deletion count > max(5, 30% of user's total DB activities), skip auto-deletion and alert BTC
    const maxDeletionThreshold = Math.max(5, Math.ceil(dbActivities.length * 0.3));
    const isAnomalousEmpty = stravaActivities.length === 0 && dbActivities.length > 0;
    const exceedsThreshold = deletedDbActivities.length > maxDeletionThreshold;

    if (!fetchComplete || isAnomalousEmpty || exceedsThreshold) {
      if (deletedDbActivities.length > 0) {
        console.warn(
          `[Historical Sync Guard] Skipped auto-deletion for ${user.nickName}. ` +
          `Reason: fetchComplete=${fetchComplete}, isAnomalousEmpty=${isAnomalousEmpty}, ` +
          `deletedCount=${deletedDbActivities.length}, maxThreshold=${maxDeletionThreshold}.`
        );
      }
    } else if (deletedDbActivities.length > 0) {
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

    // 4. Batch query existing activities to only process NEW activities
    const existingDbActivities = await db.activity.findMany({
      where: {
        userId: user.id,
        stravaActivityId: { in: Array.from(stravaActiveIds).map(id => BigInt(id)) }
      },
      select: { stravaActivityId: true }
    });

    const existingIdSet = new Set(existingDbActivities.map(a => String(a.stravaActivityId)));
    const newActivities = stravaActivities.filter(a => !existingIdSet.has(String(a.id)));

    let syncedCount = 0;
    for (const activity of newActivities) {
      const actIdStr = String(activity.id);
      if (!isActivityQueued(actIdStr, 'create')) {
        markActivityQueued(actIdStr, 'create');
        try {
          await processActivityQueueItem(activity.id, user.stravaAthleteId, 'create');
          syncedCount++;
        } finally {
          unmarkActivityQueued(actIdStr);
        }
      }
    }

    console.log(`[Historical Sync] User ${user.nickName}: ${newActivities.length} new activities processed out of ${stravaActivities.length} total fetched.`);

    return { syncedCount, deletedCount, totalFetched: stravaActivities.length };
  } catch (error: any) {
    if (error?.name === 'StravaDailyQuotaError') {
      console.warn(`[Historical Sync] Daily quota limit reached for user ${user.nickName} (App Client ${user.appClientId}). Skipping sync for now.`);
      return { syncedCount: 0, deletedCount: 0, totalFetched: 0 };
    }
    console.error(`[Historical Sync] Error syncing activities for ${user.nickName}:`, error?.response?.data || error.message);
    return { syncedCount: 0, deletedCount: 0, totalFetched: 0 };
  }
}

let isGlobalSyncing = false;

/**
 * Sync past activities for ALL onboarded users in DB with batching & throttling
 */
export async function syncAllUsersPastActivities(): Promise<{ totalUsers: number; totalSynced: number; totalDeleted: number; isAlreadyRunning?: boolean }> {
  if (isGlobalSyncing) {
    console.warn('[Historical Sync] Global sync is already running in background. Skipping duplicate trigger.');
    return { totalUsers: 0, totalSynced: 0, totalDeleted: 0, isAlreadyRunning: true };
  }

  isGlobalSyncing = true;
  try {
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

      // Safety pause 250ms between users
      await sleep(250);
    }

    console.log(`[Historical Sync] Finished batch sync for ALL users. Synced: ${totalSynced}, Deleted Cleanup: ${totalDeleted}`);
    return { totalUsers: users.length, totalSynced, totalDeleted };
  } finally {
    isGlobalSyncing = false;
  }
}
