import { db } from '../config/db';
import { env } from '../config/env';

export interface StravaAppCredentials {
  clientId: string;
  clientSecret: string;
}

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
 * Selects an available Strava App from the pool using Round-Robin rotation.
 * Evenly distributes load across all apps with < 10 connected athletes to prevent overloading a single app.
 */
export async function getAvailableStravaApp(): Promise<StravaAppCredentials> {
  const pool = getStravaAppPool();

  if (pool.length <= 1) {
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

  // Filter eligible apps that currently have < 10 total (DB connected + pending attempts)
  const eligibleApps = pool.filter(app => {
    const dbCount = countMap.get(app.clientId) || 0;
    const pendingCount = pendingCountMap.get(app.clientId) || 0;
    return (dbCount + pendingCount) < 10;
  });

  let selectedApp: StravaAppCredentials;

  if (eligibleApps.length > 0) {
    // Select evenly via Round-Robin rotation
    selectedApp = eligibleApps[roundRobinIndex % eligibleApps.length];
    roundRobinIndex = (roundRobinIndex + 1) % eligibleApps.length;
  } else {
    // If all apps reached 10, select app with minimum total load
    selectedApp = pool.reduce((best, current) => {
      const bestCount = (countMap.get(best.clientId) || 0) + (pendingCountMap.get(best.clientId) || 0);
      const currentCount = (countMap.get(current.clientId) || 0) + (pendingCountMap.get(current.clientId) || 0);
      return currentCount < bestCount ? current : best;
    }, pool[0]);
  }

  // Track pending registration attempt
  const currentPending = pendingCountMap.get(selectedApp.clientId) || 0;
  pendingCountMap.set(selectedApp.clientId, currentPending + 1);

  // Auto safety timeout: decrement pending count after 10 minutes
  setTimeout(() => {
    const p = pendingCountMap.get(selectedApp.clientId) || 0;
    if (p > 0) {
      pendingCountMap.set(selectedApp.clientId, p - 1);
    }
  }, 10 * 60 * 1000);

  const dbCount = countMap.get(selectedApp.clientId) || 0;
  const pendingCount = pendingCountMap.get(selectedApp.clientId) || 0;
  console.log(`[Strava App Pool] Selected App Client ID: ${selectedApp.clientId} (DB: ${dbCount}, Pending: ${pendingCount}, Total: ${dbCount + pendingCount}/10)`);

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
