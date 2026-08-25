import { db } from '../config/db';
import { findUserByFlexibleQuery } from './bonus.service';
import { getValidAccessToken } from './strava.service';
import { stravaHttp } from '../utils/http';
import { getTeamName } from './team.service';

export interface RemoveAthleteResult {
  success: boolean;
  nickname?: string;
  fullName?: string | null;
  teamId?: number;
  teamName?: string;
  deletedActivitiesCount?: number;
  deletedTotalKm?: number;
  deauthorizedOnStrava?: boolean;
  message: string;
}

/**
 * Completely remove an athlete from the tournament:
 * 1. Attempt to deauthorize Strava OAuth token (so Strava officially disconnects and stops firing webhook events)
 * 2. Cascade delete all Activity records, WeeklyExemption records, and the User record from the database in an atomic transaction
 */
export async function removeAthleteFromContest(query: string): Promise<RemoveAthleteResult> {
  const clean = query.trim().replace(/^@/, '');
  if (!clean) {
    return { success: false, message: 'Vui lòng cung cấp Nickname hoặc Họ tên VĐV cần loại bỏ.' };
  }

  // 1. Find user by flexible query
  const user = await findUserByFlexibleQuery(clean);
  if (!user) {
    return { success: false, message: `Không tìm thấy VĐV nào khớp với "${clean}".` };
  }

  const userId = user.id;
  const nickname = user.nickName;
  const fullName = user.fullName;
  const teamId = user.teamId;
  const teamName = getTeamName(teamId);
  const deletedTotalKm = user.totalDistance / 1000;

  // 2. Count existing activities before deletion
  const deletedActivitiesCount = await db.activity.count({ where: { userId } });

  // 3. Attempt Strava OAuth Deauthorization
  let deauthorizedOnStrava = false;
  if (user.accessToken && user.refreshToken) {
    try {
      const validToken = await getValidAccessToken({
        id: user.id,
        appClientId: user.appClientId,
        accessToken: user.accessToken,
        refreshToken: user.refreshToken,
        tokenExpiresAt: user.tokenExpiresAt
      });

      if (validToken) {
        const response = await stravaHttp.post(
          'https://www.strava.com/oauth/deauthorize',
          null,
          {
            params: { access_token: validToken }
          }
        );
        if (response.status === 200) {
          deauthorizedOnStrava = true;
          console.log(`[Athlete Removal] Successfully deauthorized Strava token for user ${nickname} (${user.stravaAthleteId})`);
        }
      }
    } catch (err: any) {
      console.warn(`[Athlete Removal] Could not deauthorize Strava token for user ${nickname}:`, err?.message || err);
      // Even if Strava deauthorize fails (e.g. token already revoked by athlete), proceed to delete from local DB
    }
  }

  // 4. Atomic Database Deletion
  await db.$transaction(async (tx) => {
    // Delete all activities
    await tx.activity.deleteMany({ where: { userId } });
    // Delete all weekly exemptions
    await tx.weeklyExemption.deleteMany({ where: { userId } });
    // Delete the user record
    await tx.user.delete({ where: { id: userId } });
  });

  console.log(`[Athlete Removal] Successfully removed athlete ${nickname} (${userId}) from DB. Deleted ${deletedActivitiesCount} activities (${deletedTotalKm.toFixed(2)} km).`);

  return {
    success: true,
    nickname,
    fullName,
    teamId,
    teamName,
    deletedActivitiesCount,
    deletedTotalKm,
    deauthorizedOnStrava,
    message: `Đã loại bỏ hoàn toàn VĐV ${fullName || nickname} khỏi giải đấu. Toàn bộ ${deletedActivitiesCount} bài chạy (${deletedTotalKm.toFixed(2)} km) đã được xóa sạch khỏi hệ thống.`
  };
}
