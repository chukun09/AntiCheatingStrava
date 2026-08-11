import { AxiosResponse } from 'axios';
import { stravaHttp } from '../utils/http';
import { db } from '../config/db';
import { getAppCredentials } from './stravapool.service';
import { stravaRateLimiter } from '../utils/ratelimit';

// Helper function to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mutex Map to deduplicate concurrent token refresh calls for the same user
const tokenRefreshPromises = new Map<string, Promise<string | null>>();

/**
 * Inspects Strava API response headers for Rate Limit usage and updates rate limiter.
 */
function checkRateLimitHeaders(userClientId: string | null | undefined, response: AxiosResponse) {
  const readUsage = response.headers['x-readratelimit-usage'] || response.headers['x-ratelimit-usage'];
  const readLimit = response.headers['x-readratelimit-limit'] || response.headers['x-ratelimit-limit'];

  const clientId = userClientId || 'default';
  stravaRateLimiter.updateFromHeaders(clientId, readUsage, readLimit);
}

/**
 * Ensures user has a valid Strava Access Token.
 * Features MUTEX DEDUPLICATION: Concurrent calls for the same user share a single refresh promise.
 */
export async function getValidAccessToken(
  user: {
    id: string;
    appClientId?: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
  },
  forceRefresh = false
): Promise<string | null> {
  if (!user.accessToken || !user.refreshToken) {
    console.error(`[Strava] User ${user.id} has no valid OAuth tokens.`);
    return null;
  }

  const now = new Date();
  const expiresAt = user.tokenExpiresAt ? new Date(user.tokenExpiresAt) : new Date(0);
  const bufferMs = 5 * 60 * 1000; // 5 minute safety buffer

  // If token is still valid and forceRefresh is false, return active access token immediately
  if (!forceRefresh && expiresAt.getTime() - bufferMs > now.getTime()) {
    return user.accessToken;
  }

  // Check if a refresh promise is already pending for this user
  if (tokenRefreshPromises.has(user.id)) {
    console.log(`[Strava Mutex] User ${user.id} already has a pending token refresh request. Awaiting shared promise...`);
    return await tokenRefreshPromises.get(user.id)!;
  }

  // Create new refresh promise and register in Mutex map
  const refreshPromise = (async (): Promise<string | null> => {
    console.log(`[Strava] Access token for user ${user.id} expired or force-refreshed. Refreshing token via App Pool...`);
    try {
      // Re-fetch latest refreshToken from DB in case another process updated it
      const freshUser = await db.user.findUnique({
        where: { id: user.id },
        select: { refreshToken: true, appClientId: true }
      });

      const refreshTokenToUse = freshUser?.refreshToken || user.refreshToken;
      const appClientIdToUse = freshUser?.appClientId || user.appClientId;

      const creds = getAppCredentials(appClientIdToUse);
      const response = await stravaHttp.post('https://www.strava.com/oauth/token', {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshTokenToUse
      });

      const { access_token, refresh_token, expires_at } = response.data;
      const newExpiresAt = new Date(expires_at * 1000);

      // Save BOTH new access_token and new refresh_token to DB
      await db.user.update({
        where: { id: user.id },
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: newExpiresAt
        }
      });

      console.log(`[Strava] Token refreshed successfully for user ${user.id}`);
      return access_token;
    } catch (error: any) {
      console.error(`[Strava] Failed to refresh token for user ${user.id}:`, error?.response?.data || error.message);
      return null;
    } finally {
      tokenRefreshPromises.delete(user.id);
    }
  })();

  tokenRefreshPromises.set(user.id, refreshPromise);
  return await refreshPromise;
}

/**
 * Fetch activity detail from Strava API v3 with Rate Limiter, 429 Retry-After logic, and 5xx backoff.
 */
export async function fetchStravaActivityDetail(
  activityId: bigint | string,
  accessToken: string,
  retryCount = 0,
  userClientId?: string | null
): Promise<any> {
  const clientId = userClientId || 'default';

  // 1. Acquire slot from Rate Limiter
  await stravaRateLimiter.acquire(clientId);

  try {
    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const response = await stravaHttp.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    // Check & record rate limit headers
    checkRateLimitHeaders(clientId, response);

    return response.data;
  } catch (error: any) {
    const status = error?.response?.status;

    // Handle Rate Limit 429 Error
    if (status === 429 && retryCount < 3) {
      const retryAfterHeader = error.response.headers['retry-after'];
      let waitSec = 15;

      if (retryAfterHeader) {
        waitSec = parseInt(retryAfterHeader, 10) || 15;
      } else {
        // Calculate wait time until next 15-minute clock boundary
        const now = new Date();
        const nextMin = (Math.floor(now.getMinutes() / 15) + 1) * 15;
        const target = new Date(now);
        target.setMinutes(nextMin, 2, 0);
        waitSec = Math.ceil((target.getTime() - now.getTime()) / 1000);
      }

      console.warn(`[Strava API 429] Rate limit hit for activity ${activityId}! Waiting ${waitSec}s until next window (Attempt ${retryCount + 1}/3)...`);
      await sleep(waitSec * 1000);
      return fetchStravaActivityDetail(activityId, accessToken, retryCount + 1, clientId);
    }

    // Handle Server 5xx / Network Timeout Errors (Retry up to 3 times with exponential backoff)
    if ((!status || status >= 500) && retryCount < 3) {
      const backoffMs = Math.pow(2, retryCount) * 1000;
      console.warn(`[Strava API ${status || 'Network Error'}] Temporary error on activity ${activityId}. Retrying in ${backoffMs}ms (Attempt ${retryCount + 1}/3)...`);
      await sleep(backoffMs);
      return fetchStravaActivityDetail(activityId, accessToken, retryCount + 1, clientId);
    }

    console.error(`[Strava] Failed to fetch activity ${activityId}:`, error?.response?.data || error.message);
    throw error;
  }
}
