import { db } from '../config/db';
import { env } from '../config/env';
import { stravaRateLimiter } from '../utils/ratelimit';

export interface StravaAppCredentials {
  clientId: string;
  clientSecret: string;
}

// Strict maximum ceiling of connected users per Strava App (Development mode cap is 10)
// We cap at 9 to maximize capacity while leaving a 1-user safety margin for re-authorizations
export const MAX_USERS_PER_APP = 9;

/**
 * Returns all configured Strava Apps in the pool.
 * Fallbacks to single STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET if no JSON array provided.
 */
export function getStravaAppPool(): StravaAppCredentials[] {
  if (env.STRAVA_APPS_JSON) {
    try {
      const parsed = JSON.parse(env.STRAVA_APPS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any) => ({
          clientId: String(item.clientId || item.client_id || '').trim(),
          clientSecret: String(item.clientSecret || item.client_secret || '').trim()
        })).filter(app => app.clientId && app.clientSecret);
      }
    } catch (e) {
      console.warn('[Strava App Pool] Failed to parse STRAVA_APPS_JSON:', e);
    }
  }

  // Fallback to default single app
  if (env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET) {
    return [{
      clientId: env.STRAVA_CLIENT_ID.trim(),
      clientSecret: env.STRAVA_CLIENT_SECRET.trim()
    }];
  }

  return [];
}

/**
 * Gets exact app credentials by clientId, or fallback to default app credentials.
 */
export function getAppCredentials(clientId?: string | null): StravaAppCredentials {
  const pool = getStravaAppPool();
  if (clientId) {
    const matched = pool.find(a => a.clientId === clientId);
    if (matched) return matched;
  }

  // Fallback to first available or env default
  if (pool.length > 0) return pool[0];

  return {
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET
  };
}

let roundRobinIndex = 0;
const pendingCountMap = new Map<string, number>();

/**
 * Decrement pending count attempt when OAuth flow completes or fails
 */
export function decrementPendingApp(clientId?: string | null): void {
  if (!clientId) return;
  const p = pendingCountMap.get(clientId) || 0;
  if (p > 0) {
    pendingCountMap.set(clientId, p - 1);
  }
}

/**
 * Selects an available Strava App from the pool.
 * Features:
 * 1. Hard cap at MAX_USERS_PER_APP (8 users) per App to prevent HTTP 403 Forbidden errors.
 * 2. Rate Limit Filtering: Filters out apps currently at >= 90% usage.
 * 3. Returns null if ALL apps in the pool reached the 8-user maximum capacity.
 */
export async function getAvailableStravaApp(): Promise<StravaAppCredentials | null> {
  const pool = getStravaAppPool();

  if (pool.length === 0) {
    return getAppCredentials();
  }

  // Count existing athletes per appClientId in DB
  const users = await db.user.findMany({
    select: { appClientId: true }
  });

  const countMap = new Map<string, number>();
  users.forEach(u => {
    const cid = u.appClientId || pool[0].clientId;
    countMap.set(cid, (countMap.get(cid) || 0) + 1);
  });

  // Calculate total load (DB connected + pending attempts) for each app
  const appLoads = pool.map(app => {
    const dbCount = countMap.get(app.clientId) || 0;
    const pendingCount = pendingCountMap.get(app.clientId) || 0;
    const isRateLimited = stravaRateLimiter.isRateLimited(app.clientId);
    return {
      app,
      dbCount,
      pendingCount,
      totalLoad: dbCount + pendingCount,
      isRateLimited
    };
  });

  // Filter apps under MAX_USERS_PER_APP (8) AND NOT currently rate-limited
  let eligibleAppLoads = appLoads.filter(item => item.totalLoad < MAX_USERS_PER_APP && !item.isRateLimited);

  // Fallback: If all un-full apps are rate-limited, relax rate-limit filter but still enforce MAX_USERS_PER_APP (8)
  if (eligibleAppLoads.length === 0) {
    eligibleAppLoads = appLoads.filter(item => item.totalLoad < MAX_USERS_PER_APP);
  }

  // HARD CAP SAFETY GUARD: If ALL apps in the pool reached MAX_USERS_PER_APP (8), return null to show friendly warning screen!
  if (eligibleAppLoads.length === 0) {
    console.warn(`[Strava App Pool WARNING] ALL ${pool.length} Strava Apps reached the maximum capacity of ${MAX_USERS_PER_APP} users!`);
    return null;
  }

  // Find the minimum load among eligible apps (Least Connected Users First)
  const minLoad = Math.min(...eligibleAppLoads.map(item => item.totalLoad));
  
  // Get all candidate apps that share this minimum load
  const candidateApps = eligibleAppLoads.filter(item => item.totalLoad === minLoad).map(item => item.app);

  // Rotate evenly via Round-Robin among the least connected candidate apps
  const selectedApp = candidateApps[roundRobinIndex % candidateApps.length];
  roundRobinIndex = (roundRobinIndex + 1) % candidateApps.length;

  // Track pending registration attempt
  const currentPending = pendingCountMap.get(selectedApp.clientId) || 0;
  pendingCountMap.set(selectedApp.clientId, currentPending + 1);

  // Auto safety timeout: decrement pending count after 2 minutes
  setTimeout(() => {
    decrementPendingApp(selectedApp.clientId);
  }, 2 * 60 * 1000);

  const dbCount = countMap.get(selectedApp.clientId) || 0;
  const pendingCount = pendingCountMap.get(selectedApp.clientId) || 0;
  console.log(
    `[Strava App Pool] Selected App Client ID: ${selectedApp.clientId} ` +
    `(DB: ${dbCount}, Pending: ${pendingCount}, Total: ${dbCount + pendingCount}/${MAX_USERS_PER_APP})`
  );

  return selectedApp;
}

/**
 * Automatically populates default appClientId for existing legacy users in DB who have null appClientId.
 */
export async function migrateLegacyUsersAppClientId() {
  try {
    // Ensure column exists in PostgreSQL DDL
    await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appClientId" TEXT;`);

    const pool = getStravaAppPool();
    if (pool.length > 0) {
      const defaultClientId = pool[0].clientId;
      const res = await db.user.updateMany({
        where: { appClientId: null, stravaAthleteId: { not: null } },
        data: { appClientId: defaultClientId }
      });
      if (res.count > 0) {
        console.log(`[Strava App Pool] Migrated ${res.count} legacy users to default appClientId (${defaultClientId}).`);
      }
    }
  } catch (e: any) {
    console.warn('[Strava App Pool] Legacy user migration notice:', e?.message || e);
  }
}
