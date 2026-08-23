import { db } from '../config/db';
import { WEEKS } from './awards.service';
import { getExemptUserIdsForWeek } from './exemption.service';

export interface AthleteGrowthStat {
  user: {
    id: string;
    nickName: string;
    fullName: string | null;
    gender: string;
    teamId: number;
    department: string | null;
  };
  targetWeekKm: number;
  baseWeekKm: number;
  deltaKm: number;
  growthPercent: number | null; // null if baseWeekKm === 0
}

export interface GrowthLeaderboardResult {
  targetWeekNum: number;
  baseWeekNum: number;
  targetWeekName: string;
  baseWeekName: string;
  limit: number;
  totalGrowingAthletes: number;
  rankings: AthleteGrowthStat[];
  topMales: AthleteGrowthStat[];
  topFemales: AthleteGrowthStat[];
}

export interface GrowthQueryOptions {
  targetWeek?: string | number;
  baseWeek?: string | number;
  limit?: string | number;
}

/**
 * Calculates the growth / progress leaderboard comparing distance between two weeks (e.g. Week 3 vs Week 2).
 */
export async function getGrowthLeaderboard(options?: GrowthQueryOptions): Promise<GrowthLeaderboardResult> {
  // Default: Week 3 vs Week 2, Top 10
  let targetWeekNum = 3;
  let baseWeekNum = 2;
  let limit = 10;

  if (options?.targetWeek !== undefined && options?.targetWeek !== null && options?.targetWeek !== '') {
    const rawTarget = String(options.targetWeek).trim().toLowerCase().replace(/[\s_]+/g, '');
    const match = rawTarget.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed >= 2 && parsed <= 4) {
        targetWeekNum = parsed;
        baseWeekNum = parsed - 1;
      }
    }
  }

  if (options?.baseWeek !== undefined && options?.baseWeek !== null && options?.baseWeek !== '') {
    const rawBase = String(options.baseWeek).trim().toLowerCase().replace(/[\s_]+/g, '');
    const match = rawBase.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed >= 1 && parsed <= 4 && parsed !== targetWeekNum) {
        baseWeekNum = parsed;
      }
    }
  }

  if (options?.limit !== undefined && options?.limit !== null && options?.limit !== '') {
    const parsedLimit = parseInt(String(options.limit).trim(), 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(100, parsedLimit);
    }
  }

  const targetWeekObj = WEEKS[targetWeekNum - 1];
  const baseWeekObj = WEEKS[baseWeekNum - 1];

  const targetWeekName = targetWeekObj ? targetWeekObj.name : `Tuần ${targetWeekNum}`;
  const baseWeekName = baseWeekObj ? baseWeekObj.name : `Tuần ${baseWeekNum}`;

  const [users, targetExemptUserIds] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        nickName: true,
        fullName: true,
        gender: true,
        teamId: true,
        department: true
      }
    }),
    getExemptUserIdsForWeek(targetWeekNum)
  ]);

  // Query activities in targetWeek and baseWeek
  const [targetActs, baseActs] = await Promise.all([
    db.activity.groupBy({
      by: ['userId'],
      where: {
        isLegit: true,
        startDate: {
          gte: targetWeekObj.start,
          lt: targetWeekObj.end
        }
      },
      _sum: { distance: true }
    }),
    db.activity.groupBy({
      by: ['userId'],
      where: {
        isLegit: true,
        startDate: {
          gte: baseWeekObj.start,
          lt: baseWeekObj.end
        }
      },
      _sum: { distance: true }
    })
  ]);

  const targetDistMap = new Map<string, number>();
  targetActs.forEach(a => {
    targetDistMap.set(a.userId, (a._sum.distance || 0) / 1000);
  });

  const baseDistMap = new Map<string, number>();
  baseActs.forEach(a => {
    baseDistMap.set(a.userId, (a._sum.distance || 0) / 1000);
  });

  // Calculate delta for all users (excluding those on sick leave in target week)
  const allGrowth: AthleteGrowthStat[] = users
    .filter(u => !targetExemptUserIds.has(u.id))
    .map(u => {
      const targetWeekKm = targetDistMap.get(u.id) || 0;
      const baseWeekKm = baseDistMap.get(u.id) || 0;
      const deltaKm = targetWeekKm - baseWeekKm;
      const growthPercent = baseWeekKm > 0 ? (deltaKm / baseWeekKm) * 100 : null;

      return {
        user: u,
        targetWeekKm,
        baseWeekKm,
        deltaKm,
        growthPercent
      };
    });

  // Filter only athletes with positive growth (deltaKm > 0)
  const growingAthletes = allGrowth
    .filter(g => g.deltaKm > 0.001)
    .sort((a, b) => b.deltaKm - a.deltaKm);

  const rankings = growingAthletes.slice(0, limit);
  const topMales = growingAthletes.filter(g => g.user.gender === 'MALE').slice(0, limit);
  const topFemales = growingAthletes.filter(g => g.user.gender === 'FEMALE').slice(0, limit);

  return {
    targetWeekNum,
    baseWeekNum,
    targetWeekName,
    baseWeekName,
    limit,
    totalGrowingAthletes: growingAthletes.length,
    rankings,
    topMales,
    topFemales
  };
}
