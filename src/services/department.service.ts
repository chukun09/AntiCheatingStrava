import { db } from '../config/db';
import { WEEKS } from './awards.service';

export interface DepartmentSummaryItem {
  departmentName: string;
  totalMembers: number;
  qualifiedMembers: number;
  qualifiedRate: number;
  totalDistanceKm: number;
  avgKmPerMember: number;
}

export interface DepartmentLeaderboardResult {
  periodTitle: string;
  weekNumber: number | null;
  departments: DepartmentSummaryItem[];
  totalCompanyUsers: number;
  totalQualifiedUsers: number;
  companyCompletionRate: number;
}

export interface DepartmentMemberDetail {
  id: string;
  nickName: string;
  fullName: string | null;
  gender: string;
  teamId: number;
  totalDistanceKm: number;
  runCount: number;
  avgPaceSecPerKm: number;
  isQualified: boolean;
}

export interface DepartmentDetailResult {
  departmentName: string;
  periodTitle: string;
  weekNumber: number | null;
  totalMembers: number;
  qualifiedMembers: number;
  qualifiedRate: number;
  totalDistanceKm: number;
  avgKmPerMember: number;
  members: DepartmentMemberDetail[];
}

/**
 * Helper to parse week parameter (e.g. 1, 2, 3, 4, 'tuan3', 'w3', 'tatca')
 */
export function parseWeekParam(rawParam?: string | number | null): number | null {
  if (rawParam === undefined || rawParam === null || rawParam === '') return null;
  const str = String(rawParam).trim().toLowerCase().replace(/[\s_]+/g, '');
  if (str === 'tatca' || str === 'all') return null;
  const match = str.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    if (num >= 1 && num <= 4) return num;
  }
  return null;
}

/**
 * Get Leaderboard of all departments filtered by week or whole contest.
 * Computes the number of members in each department who met the 3km threshold in that week.
 */
export async function getDepartmentSummaryLeaderboard(weekParam?: number | string | null): Promise<DepartmentLeaderboardResult> {
  const weekNumber = parseWeekParam(weekParam);
  let dateFilter: { gte?: Date; lt?: Date } = {};
  let periodTitle = 'Toàn Chiến Dịch (03/08 - 30/08)';

  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    const weekObj = WEEKS[weekNumber - 1];
    dateFilter = { gte: weekObj.start, lt: weekObj.end };
    periodTitle = weekObj.name;
  }

  const users = await db.user.findMany({
    orderBy: { department: 'asc' }
  });

  // Fetch legitimate activities in period
  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      ...(weekNumber ? { startDate: dateFilter } : {})
    }
  });

  // Aggregate stats per user
  const userStatsMap = new Map<string, { totalDistanceKm: number; runCount: number; movingSec: number }>();
  activities.forEach(act => {
    const distKm = act.distance / 1000;
    const current = userStatsMap.get(act.userId) || { totalDistanceKm: 0, runCount: 0, movingSec: 0 };
    current.totalDistanceKm += distKm;
    current.runCount += 1;
    current.movingSec += act.movingTime;
    userStatsMap.set(act.userId, current);
  });

  // Group by department
  const deptMap = new Map<string, { totalMembers: number; qualifiedMembers: number; totalDistanceKm: number }>();

  let totalQualifiedUsers = 0;

  users.forEach(u => {
    const deptName = u.department?.trim() || 'Chưa phân phòng';
    const stat = deptMap.get(deptName) || { totalMembers: 0, qualifiedMembers: 0, totalDistanceKm: 0 };

    let userKm = 0;
    if (weekNumber) {
      userKm = userStatsMap.get(u.id)?.totalDistanceKm || 0;
    } else {
      userKm = u.totalDistance / 1000;
    }

    stat.totalMembers += 1;
    stat.totalDistanceKm += userKm;

    let isQualified = false;
    if (weekNumber) {
      isQualified = userKm >= 3.0;
    } else {
      const targetKm = u.gender === 'FEMALE' ? 15 : 30;
      isQualified = userKm >= targetKm;
    }

    if (isQualified) {
      stat.qualifiedMembers += 1;
      totalQualifiedUsers += 1;
    }

    deptMap.set(deptName, stat);
  });

  const departmentList: DepartmentSummaryItem[] = Array.from(deptMap.entries()).map(([departmentName, s]) => {
    const qualifiedRate = s.totalMembers > 0 ? (s.qualifiedMembers / s.totalMembers) * 100 : 0;
    const avgKmPerMember = s.totalMembers > 0 ? s.totalDistanceKm / s.totalMembers : 0;
    return {
      departmentName,
      totalMembers: s.totalMembers,
      qualifiedMembers: s.qualifiedMembers,
      qualifiedRate,
      totalDistanceKm: s.totalDistanceKm,
      avgKmPerMember
    };
  }).sort((a, b) => {
    // Sort by qualified rate descending, then by total distance descending
    if (Math.abs(b.qualifiedRate - a.qualifiedRate) > 0.01) {
      return b.qualifiedRate - a.qualifiedRate;
    }
    return b.totalDistanceKm - a.totalDistanceKm;
  });

  const totalCompanyUsers = users.length;
  const companyCompletionRate = totalCompanyUsers > 0 ? (totalQualifiedUsers / totalCompanyUsers) * 100 : 0;

  return {
    periodTitle,
    weekNumber,
    departments: departmentList,
    totalCompanyUsers,
    totalQualifiedUsers,
    companyCompletionRate
  };
}

/**
 * Get detailed member breakdown for a specific department and optional week.
 */
export async function getDepartmentMembersDetail(
  searchDept: string,
  weekParam?: number | string | null
): Promise<DepartmentDetailResult | null> {
  const weekNumber = parseWeekParam(weekParam);
  let dateFilter: { gte?: Date; lt?: Date } = {};
  let periodTitle = 'Toàn Chiến Dịch (03/08 - 30/08)';

  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    const weekObj = WEEKS[weekNumber - 1];
    dateFilter = { gte: weekObj.start, lt: weekObj.end };
    periodTitle = weekObj.name;
  }

  // Find users in matching department
  const users = await db.user.findMany({
    where: {
      department: { contains: searchDept, mode: 'insensitive' }
    },
    orderBy: { nickName: 'asc' }
  });

  if (users.length === 0) {
    return null;
  }

  const actualDeptName = users[0].department || searchDept;
  const userIds = users.map(u => u.id);

  // Fetch legitimate activities
  const activities = await db.activity.findMany({
    where: {
      userId: { in: userIds },
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

  let totalDeptDistanceKm = 0;
  let qualifiedMembers = 0;

  const members: DepartmentMemberDetail[] = users.map(u => {
    let userKm = 0;
    let runCount = 0;
    let movingSec = 0;

    if (weekNumber) {
      const stat = userStatsMap.get(u.id);
      userKm = stat ? stat.totalDistanceKm : 0;
      runCount = stat ? stat.runCount : 0;
      movingSec = stat ? stat.movingSec : 0;
    } else {
      userKm = u.totalDistance / 1000;
      const stat = userStatsMap.get(u.id);
      runCount = stat ? stat.runCount : 0;
      movingSec = stat ? stat.movingSec : 0;
    }

    totalDeptDistanceKm += userKm;
    const avgPaceSecPerKm = userKm > 0 ? movingSec / userKm : Number.POSITIVE_INFINITY;

    let isQualified = false;
    if (weekNumber) {
      isQualified = userKm >= 3.0;
    } else {
      const targetKm = u.gender === 'FEMALE' ? 15 : 30;
      isQualified = userKm >= targetKm;
    }

    if (isQualified) qualifiedMembers++;

    return {
      id: u.id,
      nickName: u.nickName,
      fullName: u.fullName,
      gender: u.gender,
      teamId: u.teamId,
      totalDistanceKm: userKm,
      runCount,
      avgPaceSecPerKm,
      isQualified
    };
  });

  // Sort members by totalDistanceKm descending
  members.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  const qualifiedRate = users.length > 0 ? (qualifiedMembers / users.length) * 100 : 0;
  const avgKmPerMember = users.length > 0 ? totalDeptDistanceKm / users.length : 0;

  return {
    departmentName: actualDeptName,
    periodTitle,
    weekNumber,
    totalMembers: users.length,
    qualifiedMembers,
    qualifiedRate,
    totalDistanceKm: totalDeptDistanceKm,
    avgKmPerMember,
    members
  };
}
