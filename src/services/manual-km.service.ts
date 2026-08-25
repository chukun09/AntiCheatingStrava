import { db } from '../config/db';
import { WEEKS } from './awards.service';
import { findUserByFlexibleQuery } from './bonus.service';
import { recalculateUserStats } from './override.service';
import { getTeamName } from './team.service';

export const MANUAL_KM_PREFIX = '8888';

export interface GrantManualKmOptions {
  query: string; // Nickname or Full Name
  km: number;
  week?: number | string | null;
  reason?: string | null;
}

export interface GrantManualKmResult {
  success: boolean;
  nickname?: string;
  fullName?: string | null;
  teamName?: string;
  km?: number;
  week?: number;
  activityId?: string;
  totalKmAfter?: number;
  message: string;
}

export interface RevokeManualKmResult {
  success: boolean;
  nickname?: string;
  fullName?: string | null;
  kmDeducted?: number;
  activityId?: string;
  totalKmAfter?: number;
  message: string;
}

/**
 * Detect current active week (1-4) based on current timestamp
 */
export function getCurrentWeekNumber(): number {
  const now = new Date();
  for (const w of WEEKS) {
    if (now >= w.start && now < w.end) {
      return w.week;
    }
  }
  return 4; // Fallback to Week 4
}

/**
 * Actively grant manual km to an athlete (e.g. step count conversion)
 */
export async function grantManualKm(options: GrantManualKmOptions): Promise<GrantManualKmResult> {
  const cleanQuery = options.query.trim().replace(/^@/, '');
  if (!cleanQuery) {
    return { success: false, message: 'Vui lòng cung cấp Nickname hoặc Họ tên VĐV.' };
  }

  const user = await findUserByFlexibleQuery(cleanQuery);
  if (!user) {
    return { success: false, message: `Không tìm thấy VĐV nào khớp với "${cleanQuery}".` };
  }

  const km = options.km;
  if (isNaN(km) || km <= 0) {
    return { success: false, message: 'Số km cộng không hợp lệ (phải > 0).' };
  }

  if (km > 100) {
    return { success: false, message: 'Số km cộng một lần vượt quá giới hạn an toàn (tối đa 100km).' };
  }

  // Determine week number (1-4)
  let weekNum = getCurrentWeekNumber();
  if (options.week !== undefined && options.week !== null && options.week !== '') {
    const raw = String(options.week).trim().toLowerCase();
    const match = raw.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed >= 1 && parsed <= 4) {
        weekNum = parsed;
      }
    }
  }

  const weekObj = WEEKS[weekNum - 1] || WEEKS[3];
  const now = new Date();
  let activityDate: Date;

  if (now >= weekObj.start && now < weekObj.end) {
    activityDate = now;
  } else {
    // Set timestamp to noon of day 2 in that week
    activityDate = new Date(weekObj.start.getTime() + 36 * 3600 * 1000);
  }

  // Generate unique pseudo Strava Activity ID: 8888 + 2-digit week + 6 random digits
  let pseudoId = BigInt(0);
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    attempts++;
    const randSuffix = Math.floor(100000 + Math.random() * 900000);
    const idStr = `${MANUAL_KM_PREFIX}${String(weekNum).padStart(2, '0')}${randSuffix}`;
    pseudoId = BigInt(idStr);

    const existing = await db.activity.findUnique({
      where: { stravaActivityId: pseudoId }
    });
    if (!existing) isUnique = true;
  }

  const distanceMeters = Math.round(km * 1000);
  // Default Pace 8:00 min/km (480s/km)
  const movingTimeSec = Math.round(km * 480);
  const reasonText = options.reason ? options.reason.trim() : 'Ghi nhận bước chân';

  await db.activity.create({
    data: {
      stravaActivityId: pseudoId,
      userId: user.id,
      name: `👟 BTC cộng km: +${km.toFixed(2)} km (${reasonText})`,
      distance: distanceMeters,
      movingTime: movingTimeSec,
      elapsedTime: movingTimeSec,
      averagePace: 480, // Pace 8:00 min/km
      maxSpeed: 2.5, // ~9 km/h
      isLegit: true,
      flagReason: `BTC cộng km thủ công [Tuần ${weekNum}]: ${reasonText}`,
      startDate: activityDate,
      type: 'Run',
      deviceName: 'Hệ thống IRIS (BTC cộng tay)',
      hasHeartrate: false
    }
  });

  // Recalculate stats for user immediately
  await recalculateUserStats(user.id);

  const updatedUser = await db.user.findUnique({ where: { id: user.id } });
  const totalKmAfter = updatedUser ? updatedUser.totalDistance / 1000 : (user.totalDistance + distanceMeters) / 1000;

  return {
    success: true,
    nickname: user.nickName,
    fullName: user.fullName,
    teamName: getTeamName(user.teamId),
    km,
    week: weekNum,
    activityId: pseudoId.toString(),
    totalKmAfter,
    message: `Đã cộng thành công +${km.toFixed(2)} km cho VĐV ${user.fullName || user.nickName} trong Tuần ${weekNum}.`
  };
}

/**
 * Revoke/delete a manually granted km activity by ID or most recent activity of user
 */
export async function revokeManualKm(queryOrActivityId: string): Promise<RevokeManualKmResult> {
  const clean = queryOrActivityId.trim().replace(/^@/, '');
  if (!clean) {
    return { success: false, message: 'Vui lòng nhập Mã Activity ID hoặc Nickname của bài cộng tay cần hủy.' };
  }

  // 1. Try finding by stravaActivityId
  const matchId = clean.match(/^\d{10,14}$/);
  let activity = null;

  if (matchId) {
    activity = await db.activity.findUnique({
      where: { stravaActivityId: BigInt(matchId[0]) },
      include: { user: true }
    });
  }

  // 2. If not found by ID, search most recent manual activity of that user
  if (!activity) {
    const user = await findUserByFlexibleQuery(clean);
    if (user) {
      activity = await db.activity.findFirst({
        where: {
          userId: user.id,
          name: { contains: 'BTC cộng km' }
        },
        include: { user: true },
        orderBy: { startDate: 'desc' }
      });
    }
  }

  if (!activity) {
    return { success: false, message: `Không tìm thấy bài chạy cộng tay nào khớp với "${clean}".` };
  }

  const userId = activity.userId;
  const distKm = activity.distance / 1000;
  const actIdStr = activity.stravaActivityId.toString();
  const userName = activity.user?.fullName || activity.user?.nickName || 'VĐV';
  const nickName = activity.user?.nickName || '';

  // Delete manual activity
  await db.activity.delete({
    where: { stravaActivityId: activity.stravaActivityId }
  });

  // Recalculate stats for user
  await recalculateUserStats(userId);

  const updatedUser = await db.user.findUnique({ where: { id: userId } });
  const totalKmAfter = updatedUser ? updatedUser.totalDistance / 1000 : 0;

  return {
    success: true,
    nickname: nickName,
    fullName: userName,
    kmDeducted: distKm,
    activityId: actIdStr,
    totalKmAfter,
    message: `Đã thu hồi thành công bài cộng tay ${actIdStr} (-${distKm.toFixed(2)} km) của VĐV ${userName}.`
  };
}

/**
 * List all manually granted activities, optionally filtered by week
 */
export async function getManualKmList(weekNumber?: number | null) {
  let dateFilter: any = {};
  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    const weekObj = WEEKS[weekNumber - 1];
    if (weekObj) {
      dateFilter = {
        startDate: {
          gte: weekObj.start,
          lt: weekObj.end
        }
      };
    }
  }

  const activities = await db.activity.findMany({
    where: {
      name: { contains: 'BTC cộng km' },
      ...dateFilter
    },
    include: { user: true },
    orderBy: { startDate: 'desc' }
  });

  return activities.map(act => ({
    activityId: act.stravaActivityId.toString(),
    userId: act.userId,
    nickname: act.user.nickName,
    fullName: act.user.fullName,
    teamId: act.user.teamId,
    teamName: getTeamName(act.user.teamId),
    km: act.distance / 1000,
    startDate: act.startDate,
    flagReason: act.flagReason,
    name: act.name
  }));
}
