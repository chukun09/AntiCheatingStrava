import { db } from '../config/db';
import { WEEKS } from './awards.service';
import { TEAMS, getTeamName } from './team.service';
import { getExemptUserIdsForWeek } from './exemption.service';
import { formatPace, formatVietnamDateTime } from './telegram.service';

export interface TeamDailyProgress {
  teamId: number;
  teamName: string;
  totalMembers: number;
  activeMembersWeek4: number;
  exemptCountWeek4: number;
  totalKmWholeContest: number;
  totalKmWeek4: number;
  avgKmWeek4: number;
}

export interface TeamMin3KmDetail {
  teamId: number;
  teamName: string;
  totalMembers: number;
  activeMembersWeek4: number;
  wholeContestKmMin3: number;
  week4KmMin3: number;
  week4AvgMin3: number;
}

export interface TopAthleteItem {
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

export interface DailySummaryReportResult {
  updatedAtStr: string;
  teamProgress: TeamDailyProgress[];
  team1StatsMin3: TeamMin3KmDetail;
  team5StatsMin3: TeamMin3KmDetail;
  wholeContestGapMin3: {
    leadingTeamName: string;
    diffKm: number;
  };
  week4GapMin3: {
    leadingTeamName: string;
    diffKm: number;
    diffAvgKm: number;
  };
  top15MalesWeek4: TopAthleteItem[];
  top15FemalesWeek4: TopAthleteItem[];
  top10OverallWholeContest: TopAthleteItem[];
}

/**
 * Generate daily briefing report for Week 4 & entire contest
 */
export async function getDailySummaryReport(): Promise<DailySummaryReportResult> {
  const week4Obj = WEEKS[3] || WEEKS[WEEKS.length - 1];
  const contestStart = WEEKS[0].start;
  const contestEnd = week4Obj.end;

  const [users, exemptUserIdsW4] = await Promise.all([
    db.user.findMany({
      orderBy: { totalDistance: 'desc' }
    }),
    getExemptUserIdsForWeek(4)
  ]);

  // Fetch all legit activities in the entire contest
  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      startDate: {
        gte: contestStart,
        lt: contestEnd
      }
    }
  });

  // User activity aggregations
  const userWholeContestMap = new Map<string, { totalKm: number; totalKmMin3: number; movingSec: number; runCount: number }>();
  const userWeek4Map = new Map<string, { totalKm: number; totalKmMin3: number; movingSec: number; runCount: number }>();

  activities.forEach(act => {
    const distKm = act.distance / 1000;
    const isMin3 = act.distance >= 3000;
    const isWeek4 = act.startDate >= week4Obj.start && act.startDate < week4Obj.end;

    // Whole contest aggregation
    const whole = userWholeContestMap.get(act.userId) || { totalKm: 0, totalKmMin3: 0, movingSec: 0, runCount: 0 };
    whole.totalKm += distKm;
    if (isMin3) whole.totalKmMin3 += distKm;
    whole.movingSec += act.movingTime;
    whole.runCount += 1;
    userWholeContestMap.set(act.userId, whole);

    // Week 4 aggregation
    if (isWeek4) {
      const w4 = userWeek4Map.get(act.userId) || { totalKm: 0, totalKmMin3: 0, movingSec: 0, runCount: 0 };
      w4.totalKm += distKm;
      if (isMin3) w4.totalKmMin3 += distKm;
      w4.movingSec += act.movingTime;
      w4.runCount += 1;
      userWeek4Map.set(act.userId, w4);
    }
  });

  // 1. Team Progress (8 teams)
  // - Whole contest: sum for ALL members in team (no exclusions, no averaging)
  // - Week 4: exclude Week 4 exempt members and calculate average km per active member
  const teamProgress: TeamDailyProgress[] = TEAMS.map(team => {
    const allMembers = users.filter(u => u.teamId === team.id);
    const totalMembers = allMembers.length;
    const activeMembers = allMembers.filter(u => !exemptUserIdsW4.has(u.id));
    const activeMembersWeek4 = activeMembers.length;
    const exemptCountWeek4 = totalMembers - activeMembersWeek4;

    let totalKmWholeContest = 0;
    let totalKmWeek4 = 0;

    // All members in team count towards whole contest total km
    allMembers.forEach(u => {
      totalKmWholeContest += userWholeContestMap.get(u.id)?.totalKm || 0;
    });

    // Only active non-exempt members count towards Week 4
    activeMembers.forEach(u => {
      totalKmWeek4 += userWeek4Map.get(u.id)?.totalKm || 0;
    });

    const avgKmWeek4 = activeMembersWeek4 > 0 ? totalKmWeek4 / activeMembersWeek4 : 0;

    return {
      teamId: team.id,
      teamName: team.name,
      totalMembers,
      activeMembersWeek4,
      exemptCountWeek4,
      totalKmWholeContest,
      totalKmWeek4,
      avgKmWeek4
    };
  }).sort((a, b) => b.avgKmWeek4 - a.avgKmWeek4 || b.totalKmWeek4 - a.totalKmWeek4);

  // 2. Team 1 vs Team 5 (Filtered by activities >= 3.0km)
  const getTeamMin3Stats = (teamId: number): TeamMin3KmDetail => {
    const teamName = getTeamName(teamId);
    const allMembers = users.filter(u => u.teamId === teamId);
    const totalMembers = allMembers.length;
    const activeMembers = allMembers.filter(u => !exemptUserIdsW4.has(u.id));
    const activeMembersWeek4 = activeMembers.length;

    let wholeContestKmMin3 = 0;
    let week4KmMin3 = 0;

    // Whole contest >= 3km: sum for ALL members
    allMembers.forEach(u => {
      wholeContestKmMin3 += userWholeContestMap.get(u.id)?.totalKmMin3 || 0;
    });

    // Week 4 >= 3km: sum for active members
    activeMembers.forEach(u => {
      week4KmMin3 += userWeek4Map.get(u.id)?.totalKmMin3 || 0;
    });

    const week4AvgMin3 = activeMembersWeek4 > 0 ? week4KmMin3 / activeMembersWeek4 : 0;

    return {
      teamId,
      teamName,
      totalMembers,
      activeMembersWeek4,
      wholeContestKmMin3,
      week4KmMin3,
      week4AvgMin3
    };
  };

  const team1StatsMin3 = getTeamMin3Stats(1);
  const team5StatsMin3 = getTeamMin3Stats(5);

  const wholeDiff = team1StatsMin3.wholeContestKmMin3 - team5StatsMin3.wholeContestKmMin3;
  const wholeContestGapMin3 = {
    leadingTeamName: wholeDiff >= 0 ? team1StatsMin3.teamName : team5StatsMin3.teamName,
    diffKm: Math.abs(wholeDiff)
  };

  const w4Diff = team1StatsMin3.week4KmMin3 - team5StatsMin3.week4KmMin3;
  const w4AvgDiff = team1StatsMin3.week4AvgMin3 - team5StatsMin3.week4AvgMin3;
  const week4GapMin3 = {
    leadingTeamName: w4Diff >= 0 ? team1StatsMin3.teamName : team5StatsMin3.teamName,
    diffKm: Math.abs(w4Diff),
    diffAvgKm: Math.abs(w4AvgDiff)
  };

  // 3. Top 15 Males & Top 15 Females in Week 4 (Excluding exempt/sick leave members)
  const malesWeek4: TopAthleteItem[] = [];
  const femalesWeek4: TopAthleteItem[] = [];

  const activeUsersW4 = users.filter(u => !exemptUserIdsW4.has(u.id));

  activeUsersW4.forEach(u => {
    const stat = userWeek4Map.get(u.id);
    const distKm = stat ? stat.totalKm : 0;
    const runCount = stat ? stat.runCount : 0;
    const movingSec = stat ? stat.movingSec : 0;
    const avgPace = distKm > 0 && movingSec > 0 ? movingSec / distKm : Number.POSITIVE_INFINITY;
    const isQualified = distKm >= 3.0;

    const item: TopAthleteItem = {
      id: u.id,
      nickName: u.nickName,
      fullName: u.fullName,
      gender: u.gender as 'MALE' | 'FEMALE',
      teamId: u.teamId,
      teamName: getTeamName(u.teamId),
      department: u.department,
      totalDistanceKm: distKm,
      runCount,
      avgPaceSecPerKm: avgPace,
      isQualified,
      isExempt: false
    };

    if (u.gender === 'MALE') {
      malesWeek4.push(item);
    } else {
      femalesWeek4.push(item);
    }
  });

  malesWeek4.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);
  femalesWeek4.sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  const top15MalesWeek4 = malesWeek4.slice(0, 15);
  const top15FemalesWeek4 = femalesWeek4.slice(0, 15);

  // 4. Top 10 Overall Club Throughout Whole Contest
  const allAthletesWholeContest: TopAthleteItem[] = users.map(u => {
    const stat = userWholeContestMap.get(u.id);
    const distKm = stat ? stat.totalKm : (u.totalDistance / 1000);
    const runCount = stat ? stat.runCount : 0;
    const movingSec = stat ? stat.movingSec : 0;
    const avgPace = distKm > 0 && movingSec > 0 ? movingSec / distKm : Number.POSITIVE_INFINITY;
    const targetKm = u.gender === 'FEMALE' ? 15 : 30;

    return {
      id: u.id,
      nickName: u.nickName,
      fullName: u.fullName,
      gender: u.gender as 'MALE' | 'FEMALE',
      teamId: u.teamId,
      teamName: getTeamName(u.teamId),
      department: u.department,
      totalDistanceKm: distKm,
      runCount,
      avgPaceSecPerKm: avgPace,
      isQualified: distKm >= targetKm
    };
  }).sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  const top10OverallWholeContest = allAthletesWholeContest.slice(0, 10);

  return {
    updatedAtStr: formatVietnamDateTime(new Date()),
    teamProgress,
    team1StatsMin3,
    team5StatsMin3,
    wholeContestGapMin3,
    week4GapMin3,
    top15MalesWeek4,
    top15FemalesWeek4,
    top10OverallWholeContest
  };
}
