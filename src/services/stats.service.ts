import { db } from '../config/db';
import { WEEKS } from './awards.service';

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
  const users = await db.user.findMany();
  const totalCompanyUsers = users.length;
  const totalMaleUsers = users.filter(u => u.gender === 'MALE').length;
  const totalFemaleUsers = users.filter(u => u.gender === 'FEMALE').length;

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

  // Classify users into qualified (>= 3.0km)
  let qualifiedUsersCount = 0;
  let qualifiedMaleCount = 0;
  let qualifiedFemaleCount = 0;

  let qualifiedCompanyDistanceKm = 0;
  let qualifiedCompanyMovingSec = 0;

  let qualifiedMaleDistanceKm = 0;
  let qualifiedMaleMovingSec = 0;

  let qualifiedFemaleDistanceKm = 0;
  let qualifiedFemaleMovingSec = 0;

  users.forEach(u => {
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
