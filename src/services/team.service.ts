import { db } from '../config/db';
import { WEEKS } from './awards.service';

export interface TeamInfo {
  id: number;
  name: string;
}

export const TEAMS: TeamInfo[] = [
  { id: 1, name: 'Đội 1: Kỹ thuật vận hành' },
  { id: 2, name: 'Đội 2: Phát triển phần mềm' },
  { id: 3, name: 'Đội 3: Chăm sóc khách hàng' },
  { id: 4, name: 'Đội 4: Kinh doanh' },
  { id: 5, name: 'Đội 5: Kế toán + Sản phẩm' },
  { id: 6, name: 'Đội 6: HCNS + Đối soát + Lái xe' },
  { id: 7, name: 'Đội 7: VP HCM + Phát triển kd' },
  { id: 8, name: 'Đội 8: HĐQT + BGĐ + Trợ lý' }
];

export function getTeamName(teamId: number): string {
  const team = TEAMS.find(t => t.id === teamId);
  return team ? team.name : `Đội ${teamId}`;
}

export interface MemberWeekStat {
  id: string;
  nickName: string;
  fullName: string | null;
  gender: string;
  department: string | null;
  totalDistanceKm: number;
  runCount: number;
  avgPaceSecPerKm: number;
  isQualified: boolean;
}

export interface TeamWeekDetailResult {
  teamId: number;
  teamName: string;
  weekNumber: number | null; // null means whole contest
  weekName: string;
  totalMembers: number;
  qualifiedMembers: number;
  totalTeamDistanceKm: number;
  members: MemberWeekStat[];
}

/**
 * Get detailed athlete-by-athlete breakdown for a specific team and optional week number.
 */
export async function getTeamWeekDetail(teamId: number, weekNumber?: number | null): Promise<TeamWeekDetailResult | null> {
  const teamName = getTeamName(teamId);
  
  // Find team members
  const users = await db.user.findMany({
    where: { teamId },
    orderBy: { nickName: 'asc' }
  });

  if (users.length === 0) {
    return null;
  }

  let weekName = 'Toàn bộ giải đấu';
  let dateFilter: { gte?: Date; lt?: Date } = {};
  let targetWeekObj: (typeof WEEKS)[0] | null = null;

  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    targetWeekObj = WEEKS[weekNumber - 1];
    weekName = targetWeekObj.name;
    dateFilter = { gte: targetWeekObj.start, lt: targetWeekObj.end };
  } else {
    // Whole contest from Week 1 start to Week 4 end
    dateFilter = { gte: WEEKS[0].start, lt: WEEKS[3].end };
  }

  const userIds = users.map(u => u.id);

  // Fetch legitimate activities for these users in the date range
  const activities = await db.activity.findMany({
    where: {
      userId: { in: userIds },
      isLegit: true,
      startDate: dateFilter
    }
  });

  // Aggregate stats per user
  const userStatsMap = new Map<string, { distanceMeters: number; movingSec: number; runCount: number }>();

  activities.forEach(a => {
    const current = userStatsMap.get(a.userId) || { distanceMeters: 0, movingSec: 0, runCount: 0 };
    current.distanceMeters += a.distance;
    current.movingSec += a.movingTime;
    current.runCount += 1;
    userStatsMap.set(a.userId, current);
  });

  let totalTeamDistanceKm = 0;
  let qualifiedMembers = 0;

  const memberStats: MemberWeekStat[] = users.map(user => {
    const stat = userStatsMap.get(user.id) || { distanceMeters: 0, movingSec: 0, runCount: 0 };
    const totalDistanceKm = stat.distanceMeters / 1000;
    totalTeamDistanceKm += totalDistanceKm;

    const avgPaceSecPerKm = totalDistanceKm > 0 ? stat.movingSec / totalDistanceKm : Number.POSITIVE_INFINITY;

    let isQualified = false;
    if (targetWeekObj) {
      if (weekNumber === 1 || weekNumber === 2) {
        isQualified = totalDistanceKm >= 3.0;
      } else {
        isQualified = totalDistanceKm > 0;
      }
    } else {
      // Whole contest goal: Female 15km, Male 30km
      const targetKm = user.gender === 'FEMALE' ? 15 : 30;
      isQualified = totalDistanceKm >= targetKm;
    }

    if (isQualified) qualifiedMembers++;

    return {
      id: user.id,
      nickName: user.nickName,
      fullName: user.fullName,
      gender: user.gender,
      department: user.department,
      totalDistanceKm,
      runCount: stat.runCount,
      avgPaceSecPerKm,
      isQualified
    };
  });

  // Sort members by totalDistanceKm descending
  memberStats.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  return {
    teamId,
    teamName,
    weekNumber: weekNumber || null,
    weekName,
    totalMembers: users.length,
    qualifiedMembers,
    totalTeamDistanceKm,
    members: memberStats
  };
}
