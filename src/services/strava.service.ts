import axios from 'axios';
import { db } from '../config/db';
import { env } from '../config/env';

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
 * Fetch activity detail from Strava API v3
 */
export async function fetchStravaActivityDetail(activityId: bigint | string, accessToken: string): Promise<any> {
  try {
    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error: any) {
    console.error(`[Strava] Failed to fetch activity ${activityId}:`, error?.response?.data || error.message);
    throw error;
  }
}
