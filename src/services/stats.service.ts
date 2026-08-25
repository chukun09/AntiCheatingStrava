import { db } from '../config/db';
import { WEEKS } from './awards.service';
import { getExemptUserIdsForWeek } from './exemption.service';
import { getTeamName } from './team.service';

export interface CompanySummaryStats {
  periodTitle: string;
  weekNumber: number | null;
  
  // Total participants counts
  totalCompanyUsers: number;
  totalMaleUsers: number;
  totalFemaleUsers: number;

  // Qualified participants (>= 3km)
  qualifiedUsersCount: number;
  qualifiedRatePercent: number;

  qualifiedMaleCount: number;
  qualifiedMaleRatePercent: number;

  qualifiedFemaleCount: number;
  qualifiedFemaleRatePercent: number;

  // Average Pace of qualified participants (seconds per km)
  companyAvgPaceSecPerKm: number;
  maleAvgPaceSecPerKm: number;
  femaleAvgPaceSecPerKm: number;

  // Total volume in period
  totalDistanceKm: number;
  totalQualifiedDistanceKm: number;
  totalActivitiesCount: number;
}

export interface SummaryQueryOptions {
  week?: string | number;
}

/**
 * Calculates comprehensive summary statistics for the whole company
 * filtered by a specific week or across the whole contest.
 */
export async function getCompanySummaryStats(options?: SummaryQueryOptions): Promise<CompanySummaryStats> {
  let dateFilter: any = {};
  let periodTitle = 'Toàn Chiến Dịch (03/08 - 30/08)';
  let weekNumber: number | null = null;

  if (options?.week !== undefined && options?.week !== null && options?.week !== '') {
    const rawWeek = String(options.week).trim().toLowerCase().replace(/[\s_]+/g, '');
    const match = rawWeek.match(/\d+/);
    if (match) {
      const parsedWeek = parseInt(match[0], 10);
      if (parsedWeek >= 1 && parsedWeek <= 4) {
        weekNumber = parsedWeek;
        const weekObj = WEEKS[parsedWeek - 1];
        if (weekObj) {
          dateFilter = {
            startDate: {
              gte: weekObj.start,
              lt: weekObj.end
            }
          };
          periodTitle = weekObj.name;
        }
      }
    }
  }

  const [allUsers, exemptUserIds] = await Promise.all([
    db.user.findMany(),
    (weekNumber && weekNumber >= 1 && weekNumber <= 4) ? getExemptUserIdsForWeek(weekNumber) : Promise.resolve(new Set<string>())
  ]);

  const activeUsers = allUsers.filter(u => !exemptUserIds.has(u.id));
  const totalCompanyUsers = activeUsers.length;
  const totalMaleUsers = activeUsers.filter(u => u.gender === 'MALE').length;
  const totalFemaleUsers = activeUsers.filter(u => u.gender === 'FEMALE').length;

  // Fetch all legit activities in the period
  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      ...dateFilter
    },
    include: {
      user: true
    }
  });

  // Aggregate stats per user in the period
  const userStatsMap = new Map<string, { totalDistanceKm: number; totalMovingSec: number; activityCount: number }>();
  let totalDistanceKm = 0;

  activities.forEach(act => {
    const distKm = act.distance / 1000;
    totalDistanceKm += distKm;

    const current = userStatsMap.get(act.userId) || { totalDistanceKm: 0, totalMovingSec: 0, activityCount: 0 };
    current.totalDistanceKm += distKm;
    current.totalMovingSec += act.movingTime;
    current.activityCount += 1;
    userStatsMap.set(act.userId, current);
  });

  // Classify active users into qualified (>= 3.0km)
  let qualifiedUsersCount = 0;
  let qualifiedMaleCount = 0;
  let qualifiedFemaleCount = 0;

  let qualifiedCompanyDistanceKm = 0;
  let qualifiedCompanyMovingSec = 0;

  let qualifiedMaleDistanceKm = 0;
  let qualifiedMaleMovingSec = 0;

  let qualifiedFemaleDistanceKm = 0;
  let qualifiedFemaleMovingSec = 0;

  activeUsers.forEach(u => {
    const stat = userStatsMap.get(u.id);
    const userKm = stat ? stat.totalDistanceKm : 0;
    const userMovingSec = stat ? stat.totalMovingSec : 0;

    if (userKm >= 3.0) {
      qualifiedUsersCount++;
      qualifiedCompanyDistanceKm += userKm;
      qualifiedCompanyMovingSec += userMovingSec;

      if (u.gender === 'MALE') {
        qualifiedMaleCount++;
        qualifiedMaleDistanceKm += userKm;
        qualifiedMaleMovingSec += userMovingSec;
      } else {
        qualifiedFemaleCount++;
        qualifiedFemaleDistanceKm += userKm;
        qualifiedFemaleMovingSec += userMovingSec;
      }
    }
  });

  const qualifiedRatePercent = totalCompanyUsers > 0 ? (qualifiedUsersCount / totalCompanyUsers) * 100 : 0;
  const qualifiedMaleRatePercent = totalMaleUsers > 0 ? (qualifiedMaleCount / totalMaleUsers) * 100 : 0;
  const qualifiedFemaleRatePercent = totalFemaleUsers > 0 ? (qualifiedFemaleCount / totalFemaleUsers) * 100 : 0;

  const companyAvgPaceSecPerKm = qualifiedCompanyDistanceKm > 0 ? qualifiedCompanyMovingSec / qualifiedCompanyDistanceKm : Number.POSITIVE_INFINITY;
  const maleAvgPaceSecPerKm = qualifiedMaleDistanceKm > 0 ? qualifiedMaleMovingSec / qualifiedMaleDistanceKm : Number.POSITIVE_INFINITY;
  const femaleAvgPaceSecPerKm = qualifiedFemaleDistanceKm > 0 ? qualifiedFemaleMovingSec / qualifiedFemaleDistanceKm : Number.POSITIVE_INFINITY;

  return {
    periodTitle,
    weekNumber,
    totalCompanyUsers,
    totalMaleUsers,
    totalFemaleUsers,
    qualifiedUsersCount,
    qualifiedRatePercent,
    qualifiedMaleCount,
    qualifiedMaleRatePercent,
    qualifiedFemaleCount,
    qualifiedFemaleRatePercent,
    companyAvgPaceSecPerKm,
    maleAvgPaceSecPerKm,
    femaleAvgPaceSecPerKm,
    totalDistanceKm,
    totalQualifiedDistanceKm: qualifiedCompanyDistanceKm,
    totalActivitiesCount: activities.length
  };
}

export interface IndividualLeaderboardItem {
  id: string;
  nickName: string;
  fullName: string | null;
  gender: 'MALE' | 'FEMALE';
  teamId: number;
  teamName: string;
  department: string | null;
  totalDistanceKm: number;
  runCount: number;
  avgPaceSecPerKm: number;
  isQualified: boolean;
  isExempt?: boolean;
}

export interface IndividualLeaderboardResult {
  periodTitle: string;
  weekNumber: number | null;
  limit: number;
  totalMales: number;
  totalFemales: number;
  qualifiedMalesCount: number;
  qualifiedFemalesCount: number;
  males: IndividualLeaderboardItem[];
  females: IndividualLeaderboardItem[];
}

export interface IndividualLeaderboardOptions {
  week?: string | number | null;
  limit?: number | string | null;
}

/**
 * Get individual leaderboard split by Male and Female,
 * supporting weekly filtering (1-4 or all) and customizable top limit.
 */
export async function getIndividualLeaderboard(options?: IndividualLeaderboardOptions): Promise<IndividualLeaderboardResult> {
  let weekNumber: number | null = null;
  if (options?.week !== undefined && options?.week !== null && options?.week !== '') {
    const rawWeek = String(options.week).trim().toLowerCase().replace(/[\s_]+/g, '');
    if (rawWeek !== 'tatca' && rawWeek !== 'all') {
      const match = rawWeek.match(/\d+/);
      if (match) {
        const parsedWeek = parseInt(match[0], 10);
        if (parsedWeek >= 1 && parsedWeek <= 4) {
          weekNumber = parsedWeek;
        }
      }
    }
  }

  let limit = 10;
  if (options?.limit !== undefined && options?.limit !== null && options?.limit !== '') {
    const parsedLimit = parseInt(String(options.limit).replace(/[^\d]/g, ''), 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = parsedLimit;
    }
  }

  let dateFilter: any = {};
  let periodTitle = 'Toàn Chiến Dịch (03/08 - 30/08)';

  if (weekNumber) {
    const weekObj = WEEKS[weekNumber - 1];
    if (weekObj) {
      dateFilter = {
        startDate: {
          gte: weekObj.start,
          lt: weekObj.end
        }
      };
      periodTitle = weekObj.name;
    }
  }

  const [allUsers, exemptUserIds] = await Promise.all([
    db.user.findMany({
      orderBy: { totalDistance: 'desc' }
    }),
    weekNumber ? getExemptUserIdsForWeek(weekNumber) : Promise.resolve(new Set<string>())
  ]);

  // Fetch activities
  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      ...dateFilter
    }
  });

  const userStatsMap = new Map<string, { totalDistanceKm: number; totalMovingSec: number; runCount: number }>();
  activities.forEach(act => {
    const distKm = act.distance / 1000;
    const current = userStatsMap.get(act.userId) || { totalDistanceKm: 0, totalMovingSec: 0, runCount: 0 };
    current.totalDistanceKm += distKm;
    current.totalMovingSec += act.movingTime;
    current.runCount += 1;
    userStatsMap.set(act.userId, current);
  });

  const maleItems: IndividualLeaderboardItem[] = [];
  const femaleItems: IndividualLeaderboardItem[] = [];

  let qualifiedMalesCount = 0;
  let qualifiedFemalesCount = 0;

  allUsers.forEach(u => {
    const stat = userStatsMap.get(u.id);
    const isExempt = exemptUserIds.has(u.id);
    
    let distKm = 0;
    let runCount = 0;
    let movingSec = 0;

    if (weekNumber) {
      distKm = stat ? stat.totalDistanceKm : 0;
      runCount = stat ? stat.runCount : 0;
      movingSec = stat ? stat.totalMovingSec : 0;
    } else {
      distKm = u.totalDistance / 1000;
      runCount = stat ? stat.runCount : 0;
      movingSec = stat ? stat.totalMovingSec : 0;
    }

    const avgPaceSecPerKm = distKm > 0 && movingSec > 0 ? movingSec / distKm : Number.POSITIVE_INFINITY;
    
    let isQualified = false;
    if (weekNumber) {
      isQualified = isExempt ? true : distKm >= 3.0;
    } else {
      const targetKm = u.gender === 'FEMALE' ? 15 : 30;
      isQualified = distKm >= targetKm;
    }

    if (isQualified && !isExempt) {
      if (u.gender === 'MALE') qualifiedMalesCount++;
      else qualifiedFemalesCount++;
    }

    const item: IndividualLeaderboardItem = {
      id: u.id,
      nickName: u.nickName,
      fullName: u.fullName,
      gender: u.gender as 'MALE' | 'FEMALE',
      teamId: u.teamId,
      teamName: getTeamName(u.teamId),
      department: u.department,
      totalDistanceKm: distKm,
      runCount,
      avgPaceSecPerKm,
      isQualified,
      isExempt
    };

    if (u.gender === 'MALE') {
      maleItems.push(item);
    } else {
      femaleItems.push(item);
    }
  });

  maleItems.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);
  femaleItems.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  return {
    periodTitle,
    weekNumber,
    limit,
    totalMales: maleItems.length,
    totalFemales: femaleItems.length,
    qualifiedMalesCount,
    qualifiedFemalesCount,
    males: maleItems.slice(0, limit),
    females: femaleItems.slice(0, limit)
  };
}
