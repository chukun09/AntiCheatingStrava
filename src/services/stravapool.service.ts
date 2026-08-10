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

/**
 * Selects an available Strava App from the pool that currently has < 10 connected athletes.
 * If all apps are full or none defined, returns the default fallback app.
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

  // Find first app with < 10 athletes
  for (const app of pool) {
    const currentCount = countMap.get(app.clientId) || 0;
    if (currentCount < 10) {
      console.log(`[Strava App Pool] Selected App Client ID: ${app.clientId} (${currentCount}/10 athletes connected)`);
      return app;
    }
  }

  // If all apps reached 10 athletes, select the one with lowest count
  let bestApp = pool[0];
  let minCount = Infinity;

  for (const app of pool) {
    const count = countMap.get(app.clientId) || 0;
    if (count < minCount) {
      minCount = count;
      bestApp = app;
    }
  }

  console.warn(`[Strava App Pool] All apps in pool reached limit. Selected App ${bestApp.clientId} with ${minCount} athletes.`);
  return bestApp;
}
