import { db } from '../config/db';
import { WEEKS } from './awards.service';
import { getExemptUserIdsForWeek } from './exemption.service';

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
  isExempt?: boolean;
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
  const team = TEAMS.find(t => t.id === teamId);
  if (!team) return null;

  const teamName = team.name;

  let targetWeekObj: typeof WEEKS[0] | null = null;
  let dateFilter: { gte?: Date; lt?: Date } = {};
  let weekName = 'Toàn Chiến Dịch (03/08 - 30/08)';

  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    targetWeekObj = WEEKS[weekNumber - 1];
    dateFilter = {
      gte: targetWeekObj.start,
      lt: targetWeekObj.end
    };
    weekName = targetWeekObj.name;
  }

  const [users, exemptUserIds] = await Promise.all([
    db.user.findMany({
      where: { teamId },
      orderBy: { totalDistance: 'desc' }
    }),
    (weekNumber && weekNumber >= 1 && weekNumber <= 4) ? getExemptUserIdsForWeek(weekNumber) : Promise.resolve(new Set<string>())
  ]);

  // Fetch activities of all team members
  const userIds = users.map(u => u.id);
  const activities = await db.activity.findMany({
    where: {
      userId: { in: userIds },
      isLegit: true,
      ...(targetWeekObj ? { startDate: dateFilter } : {})
    }
  });

  // Calculate distances and paces per user
  const userStatsMap = new Map<string, { distanceMeters: number; movingSec: number; runCount: number }>();
  users.forEach(u => userStatsMap.set(u.id, { distanceMeters: 0, movingSec: 0, runCount: 0 }));

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
    const isExempt = exemptUserIds.has(user.id);

    if (!isExempt) {
      totalTeamDistanceKm += totalDistanceKm;
    }

    const avgPaceSecPerKm = totalDistanceKm > 0 ? stat.movingSec / totalDistanceKm : Number.POSITIVE_INFINITY;

    let isQualified = false;
    if (targetWeekObj) {
      isQualified = isExempt ? true : totalDistanceKm >= 3.0;
    } else {
      // Whole contest goal: Female 15km, Male 30km
      const targetKm = user.gender === 'FEMALE' ? 15 : 30;
      isQualified = totalDistanceKm >= targetKm;
    }

    if (isQualified && !isExempt) qualifiedMembers++;

    return {
      id: user.id,
      nickName: user.nickName,
      fullName: user.fullName,
      gender: user.gender,
      department: user.department,
      totalDistanceKm,
      runCount: stat.runCount,
      avgPaceSecPerKm,
      isQualified,
      isExempt
    };
  });

  // Sort members by totalDistanceKm descending
  memberStats.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  const activeMembersCount = users.filter(u => !exemptUserIds.has(u.id)).length;

  return {
    teamId,
    teamName,
    weekNumber: weekNumber || null,
    weekName,
    totalMembers: activeMembersCount,
    qualifiedMembers,
    totalTeamDistanceKm,
    members: memberStats
  };
}

export interface UnqualifiedMemberInfo {
  id: string;
  nickName: string;
  fullName: string | null;
  gender: string;
  currentKm: number;
  targetKm: number;
  missingKm: number;
}

export interface TeamSummaryItem {
  teamId: number;
  teamName: string;
  totalMembers: number;
  qualifiedMembers: number;
  qualifiedRate: number;
  totalDistanceKm: number;
  avgKmPerMember: number;
  unqualifiedMembers: UnqualifiedMemberInfo[];
}

export interface TeamWeeklyLeaderboardResult {
  periodTitle: string;
  weekNumber: number | null;
  teams: TeamSummaryItem[];
  totalCompanyUsers: number;
  totalQualifiedUsers: number;
  companyCompletionRate: number;
}

/**
 * Get Leaderboard of all 8 teams filtered by week or whole contest,
 * showing the count and percentage of members who completed the 3km target.
 */
export async function getTeamWeeklyLeaderboard(weekParam?: number | string | null): Promise<TeamWeeklyLeaderboardResult> {
  let weekNumber: number | null = null;
  if (weekParam !== undefined && weekParam !== null && weekParam !== '') {
    const match = String(weekParam).match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed >= 1 && parsed <= 4) weekNumber = parsed;
    }
  }

  let dateFilter: { gte?: Date; lt?: Date } = {};
  let periodTitle = 'Toàn Chiến Dịch (03/08 - 30/08)';

  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    const weekObj = WEEKS[weekNumber - 1];
    dateFilter = { gte: weekObj.start, lt: weekObj.end };
    periodTitle = weekObj.name;
  }

  const [users, exemptUserIds] = await Promise.all([
    db.user.findMany(),
    (weekNumber && weekNumber >= 1 && weekNumber <= 4) ? getExemptUserIdsForWeek(weekNumber) : Promise.resolve(new Set<string>())
  ]);

  // Fetch legit activities
  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      ...(weekNumber ? { startDate: dateFilter } : {})
    }
  });

  const userStatsMap = new Map<string, { totalDistanceKm: number; runCount: number; movingSec: number }>();
  activities.forEach(act => {
    const distKm = act.distance / 1000;
    const current = userStatsMap.get(act.userId) || { totalDistanceKm: 0, runCount: 0, movingSec: 0 };
    current.totalDistanceKm += distKm;
    current.runCount += 1;
    current.movingSec += act.movingTime;
    userStatsMap.set(act.userId, current);
  });

  let totalQualifiedUsers = 0;

  const teamList: TeamSummaryItem[] = TEAMS.map(team => {
    // Exclude exempt users from this week's active member list
    const members = users.filter(u => u.teamId === team.id && !exemptUserIds.has(u.id));
    const totalMembers = members.length;
    let qualifiedMembers = 0;
    let totalDistanceKm = 0;
    const unqualifiedMembers: UnqualifiedMemberInfo[] = [];

    members.forEach(u => {
      let userKm = 0;
      let targetKm = 3.0;

      if (weekNumber) {
        userKm = userStatsMap.get(u.id)?.totalDistanceKm || 0;
        targetKm = 3.0;
      } else {
        userKm = u.totalDistance / 1000;
        targetKm = u.gender === 'FEMALE' ? 15 : 30;
      }
      totalDistanceKm += userKm;

      let isQualified = false;
      if (weekNumber) {
        // exemptUserIds would be empty if weekNumber is null/undefined, but handled here for safety
        isQualified = exemptUserIds.has(u.id) ? true : userKm >= targetKm;
      } else {
        isQualified = userKm >= targetKm;
      }

      if (isQualified) {
        qualifiedMembers++;
        totalQualifiedUsers++;
      } else {
        unqualifiedMembers.push({
          id: u.id,
          nickName: u.nickName,
          fullName: u.fullName,
          gender: u.gender,
          currentKm: userKm,
          targetKm,
          missingKm: Math.max(0, targetKm - userKm)
        });
      }
    });

    unqualifiedMembers.sort((a, b) => b.currentKm - a.currentKm);

    const qualifiedRate = totalMembers > 0 ? (qualifiedMembers / totalMembers) * 100 : 0;
    const avgKmPerMember = totalMembers > 0 ? totalDistanceKm / totalMembers : 0;

    return {
      teamId: team.id,
      teamName: team.name,
      totalMembers,
      qualifiedMembers,
      qualifiedRate,
      totalDistanceKm,
      avgKmPerMember,
      unqualifiedMembers
    };
  }).sort((a, b) => {
    if (Math.abs(b.qualifiedRate - a.qualifiedRate) > 0.01) {
      return b.qualifiedRate - a.qualifiedRate;
    }
    return b.totalDistanceKm - a.totalDistanceKm;
  });

  const activeCompanyUsers = users.filter(u => !exemptUserIds.has(u.id)).length;
  const companyCompletionRate = activeCompanyUsers > 0 ? (totalQualifiedUsers / activeCompanyUsers) * 100 : 0;

  return {
    periodTitle,
    weekNumber,
    teams: teamList,
    totalCompanyUsers: activeCompanyUsers,
    totalQualifiedUsers,
    companyCompletionRate
  };
}
