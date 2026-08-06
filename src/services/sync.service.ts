import axios from 'axios';
import { db } from '../config/db';
import { getValidAccessToken } from './strava.service';
import { processActivityQueueItem } from './activity.service';

// Contest start timestamp: 00:00 03/08/2026
const CONTEST_START = new Date('2026-08-03T00:00:00+07:00');

// Helper to delay execution (prevents hitting Strava 100 req/15min rate limits)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sync all past running activities for a specific user since contest start date (03/08/2026)
 * Throttled to prevent Strava rate limits and CSDL connection pool overload.
 */
export async function syncUserPastActivities(userId: string): Promise<{ syncedCount: number; totalFetched: number }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.stravaAthleteId) {
    console.warn(`[Historical Sync] User ${userId} has no Strava Athlete ID. Skipped.`);
    return { syncedCount: 0, totalFetched: 0 };
  }

  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    console.error(`[Historical Sync] Cannot get valid access token for user ${user.nickName}. Aborted.`);
    return { syncedCount: 0, totalFetched: 0 };
  }

  const afterEpochSec = Math.floor(CONTEST_START.getTime() / 1000);

  try {
    // Fetch athlete activities after contest start date
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterEpochSec}&per_page=200`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const activities: any[] = response.data || [];
    console.log(`[Historical Sync] Fetched ${activities.length} past activities for ${user.nickName}.`);

    let syncedCount = 0;
    for (const activity of activities) {
      // Process activity through standard queue worker pipeline
      await processActivityQueueItem(activity.id, user.stravaAthleteId);
      syncedCount++;

      // Throttle 300ms between calls to keep Strava API rate limits safe
      await sleep(300);
    }

    return { syncedCount, totalFetched: activities.length };
  } catch (error: any) {
    console.error(`[Historical Sync] Error fetching past activities for ${user.nickName}:`, error?.response?.data || error.message);
    return { syncedCount: 0, totalFetched: 0 };
  }
}

/**
 * Sync past activities for ALL onboarded users in DB with batching & throttling
 */
export async function syncAllUsersPastActivities(): Promise<{ totalUsers: number; totalSynced: number }> {
  const users = await db.user.findMany({
    where: { stravaAthleteId: { not: null } }
  });

  console.log(`[Historical Sync] Starting throttled sync for ALL ${users.length} users...`);
  let totalSynced = 0;

  for (const user of users) {
    const res = await syncUserPastActivities(user.id);
    totalSynced += res.syncedCount;

    // Safety pause 1 second between different users
    await sleep(1000);
  }

  console.log(`[Historical Sync] Finished throttled sync for ALL users. Total activities processed: ${totalSynced}`);
  return { totalUsers: users.length, totalSynced };
}
