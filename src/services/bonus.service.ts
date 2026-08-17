import { db } from '../config/db';
import { recalculateUserStats } from './override.service';

export interface BonusResult {
  success: boolean;
  nickname: string;
  fullName?: string | null;
  gender?: string | null;
  bonusKm?: number;
  message: string;
}

/**
 * Prefix used for Pickleball bonus activity pseudo Strava IDs in DB
 */
export const PICKLEBALL_BONUS_PREFIX = '999903';

/**
 * Helper to flexibly find a user by exact/partial nickname or full name,
 * with or without "IRIS" prefix, spaces, underscores, or hyphens.
 */
export async function findUserByFlexibleQuery(query: string) {
  const clean = query.trim().replace(/^@/, '');
  if (!clean) return null;

  // 1. Exact match on nickName or fullName (case-insensitive)
  let user = await db.user.findFirst({
    where: {
      OR: [
        { nickName: { equals: clean, mode: 'insensitive' } },
        { fullName: { equals: clean, mode: 'insensitive' } }
      ]
    }
  });
  if (user) return user;

  // 2. Try variations with / without "IRIS" prefix
  const withoutIris = clean.replace(/^iris[\s_-]*/i, '').trim();
  const withIrisSpace = `IRIS ${withoutIris}`;
  const withIrisNoSpace = `IRIS${withoutIris}`;
  const withIrisUnderscore = `IRIS_${withoutIris}`;

  user = await db.user.findFirst({
    where: {
      OR: [
        { nickName: { equals: withoutIris, mode: 'insensitive' } },
        { nickName: { equals: withIrisSpace, mode: 'insensitive' } },
        { nickName: { equals: withIrisNoSpace, mode: 'insensitive' } },
        { nickName: { equals: withIrisUnderscore, mode: 'insensitive' } }
      ]
    }
  });
  if (user) return user;

  // 3. Substring contains search
  user = await db.user.findFirst({
    where: {
      OR: [
        { nickName: { contains: withoutIris || clean, mode: 'insensitive' } },
        { fullName: { contains: withoutIris || clean, mode: 'insensitive' } }
      ]
    }
  });
  return user;
}

/**
 * Grant +5km (Male) or +3km (Female) Pickleball bonus in Week 3 to a list of athlete nicknames.
 */
export async function grantPickleballBonus(nicknames: string[]): Promise<BonusResult[]> {
  const results: BonusResult[] = [];

  for (const rawNick of nicknames) {
    const cleanNick = rawNick.trim().replace(/^@/, '');
    if (!cleanNick) continue;

    // Search user with flexible query logic
    const user = await findUserByFlexibleQuery(cleanNick);

    if (!user) {
      results.push({
        success: false,
        nickname: cleanNick,
        message: `Không tìm thấy VĐV với nickname hoặc họ tên "${cleanNick}".`
      });
      continue;
    }

    // Check if user already received Pickleball bonus for Week 3
    const existingBonus = await db.activity.findFirst({
      where: {
        userId: user.id,
        name: { contains: 'Pickleball', mode: 'insensitive' }
      }
    });

    if (existingBonus) {
      const distKm = (existingBonus.distance / 1000).toFixed(1);
      results.push({
        success: false,
        nickname: user.nickName,
        fullName: user.fullName,
        gender: user.gender,
        message: `Đã được cộng điểm thưởng Pickleball trước đó (+${distKm}km, ID: ${existingBonus.stravaActivityId}).`
      });
      continue;
    }

    const isMale = user.gender === 'MALE';
    const bonusDistanceMeters = isMale ? 5000 : 3000;
    const bonusKm = isMale ? 5.0 : 3.0;
    const movingTimeSec = isMale ? 1800 : 1080; // 30 mins for 5km, 18 mins for 3km (Pace 6:00 min/km)

    // Generate unique pseudo Strava Activity ID
    // 999903 + athlete ID (or random suffix if missing)
    const athleteSuffix = user.stravaAthleteId ? String(user.stravaAthleteId).slice(-6) : String(Math.floor(100000 + Math.random() * 900000));
    const pseudoId = BigInt(`${PICKLEBALL_BONUS_PREFIX}${athleteSuffix}`);

    // Create bonus activity in Week 3 (17/08/2026 08:00:00 UTC+7)
    const startDate = new Date('2026-08-17T08:00:00+07:00');

    await db.activity.create({
      data: {
        stravaActivityId: pseudoId,
        userId: user.id,
        name: `🏓 Điểm thưởng: Tham gia Giải Pickleball IRIS (+${bonusKm}km)`,
        distance: bonusDistanceMeters,
        movingTime: movingTimeSec,
        elapsedTime: movingTimeSec,
        averagePace: 360, // 6:00 min/km (360 sec/km)
        maxSpeed: 3.5, // ~12.6 km/h
        isLegit: true,
        flagReason: null,
        startDate: startDate,
        type: 'Run',
        deviceName: 'Hệ thống IRIS (BTC)',
        hasHeartrate: false
      }
    });

    // Recalculate user totalDistance & reachedTargetAt
    await recalculateUserStats(user.id);

    results.push({
      success: true,
      nickname: user.nickName,
      fullName: user.fullName,
      gender: user.gender,
      bonusKm: bonusKm,
      message: `Cộng thành công +${bonusKm}km (${isMale ? 'Nam +5km' : 'Nữ +3km'}) vào Tuần 3.`
    });
  }

  return results;
}

/**
 * Revoke Pickleball bonus for a list of athlete nicknames.
 */
export async function revokePickleballBonus(nicknames: string[]): Promise<BonusResult[]> {
  const results: BonusResult[] = [];

  for (const rawNick of nicknames) {
    const cleanNick = rawNick.trim().replace(/^@/, '');
    if (!cleanNick) continue;

    const user = await findUserByFlexibleQuery(cleanNick);

    if (!user) {
      results.push({
        success: false,
        nickname: cleanNick,
        message: `Không tìm thấy VĐV với nickname hoặc họ tên "${cleanNick}".`
      });
      continue;
    }

    const bonusActivity = await db.activity.findFirst({
      where: {
        userId: user.id,
        name: { contains: 'Pickleball', mode: 'insensitive' }
      }
    });

    if (!bonusActivity) {
      results.push({
        success: false,
        nickname: user.nickName,
        fullName: user.fullName,
        message: `VĐV chưa có bài điểm thưởng Pickleball nào trong CSDL.`
      });
      continue;
    }

    const deletedKm = (bonusActivity.distance / 1000).toFixed(1);
    await db.activity.delete({ where: { id: bonusActivity.id } });

    // Recalculate user totalDistance
    await recalculateUserStats(user.id);

    results.push({
      success: true,
      nickname: user.nickName,
      fullName: user.fullName,
      message: `Đã thu hồi bài điểm thưởng Pickleball (-${deletedKm}km) của ${user.fullName}.`
    });
  }

  return results;
}
