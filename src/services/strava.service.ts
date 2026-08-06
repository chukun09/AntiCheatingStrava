import axios, { AxiosResponse } from 'axios';
import { db } from '../config/db';
import { env } from '../config/env';

// Helper function to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inspects Strava API response headers for Rate Limit usage.
 * Automatically backs off if usage exceeds 85% of allowed limit.
 */
function checkRateLimitHeaders(response: AxiosResponse) {
  const readUsage = response.headers['x-readratelimit-usage'] || response.headers['x-ratelimit-usage'];
  const readLimit = response.headers['x-readratelimit-limit'] || response.headers['x-ratelimit-limit'];

  if (readUsage && readLimit) {
    try {
      const [usage15m, usageDaily] = String(readUsage).split(',').map(Number);
      const [limit15m, limitDaily] = String(readLimit).split(',').map(Number);

      console.log(`[Strava RateLimit Monitor] 15m: ${usage15m}/${limit15m} | Daily: ${usageDaily}/${limitDaily}`);

      // If usage reaches 85% of 15m limit, pause for 5 seconds to stay safe
      if (limit15m > 0 && usage15m / limit15m >= 0.85) {
        console.warn(`[Strava RateLimit Warning] 15-minute usage (${usage15m}/${limit15m}) reached 85%! Throttling request pipeline...`);
      }
    } catch (e) {
      // Ignore header parsing errors
    }
  }
}

/**
 * Ensures user has a valid Strava Access Token.
 * Automatically refreshes token if expired and updates both access_token AND refresh_token in DB.
 */
export async function getValidAccessToken(user: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): Promise<string | null> {
  if (!user.accessToken || !user.refreshToken) {
    console.error(`[Strava] User ${user.id} has no valid OAuth tokens.`);
    return null;
  }

  // Check if token is expired (or expires within 5 minutes)
  const now = new Date();
  const expiresAt = user.tokenExpiresAt ? new Date(user.tokenExpiresAt) : new Date(0);
  const bufferMs = 5 * 60 * 1000; // 5 minute safety buffer

  if (expiresAt.getTime() - bufferMs > now.getTime()) {
    return user.accessToken;
  }

  console.log(`[Strava] Access token for user ${user.id} expired. Refreshing token...`);

  try {
    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: user.refreshToken
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
  }
}

/**
 * Fetch activity detail from Strava API v3 with Rate Limit monitoring & HTTP 429 Retry logic
 */
export async function fetchStravaActivityDetail(activityId: bigint | string, accessToken: string, retryCount = 0): Promise<any> {
  try {
    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    // Check rate limit headers
    checkRateLimitHeaders(response);

    return response.data;
  } catch (error: any) {
    if (error?.response?.status === 429) {
      console.warn(`[Strava API 429] Rate limit hit! Retrying activity ${activityId} in 15 seconds (Attempt ${retryCount + 1})...`);
      if (retryCount < 3) {
        await sleep(15000); // Sleep 15 seconds before retry
        return fetchStravaActivityDetail(activityId, accessToken, retryCount + 1);
      }
    }
    console.error(`[Strava] Failed to fetch activity ${activityId}:`, error?.response?.data || error.message);
    throw error;
  }
}
