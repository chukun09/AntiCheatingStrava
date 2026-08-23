import { db } from '../config/db';
import { TEAMS, getTeamName } from './team.service';
import { WEEKS } from './awards.service';
import { getExemptUserIdsForWeek } from './exemption.service';

export interface ReminderAthleteInfo {
  id: string;
  nickName: string;
  fullName: string | null;
  gender: string;
  department: string | null;
  teamId: number;
  teamName: string;
  runCountInWeek: number;
  totalDistanceInWeekKm: number;
  maxSingleActivityKm: number;
}

export interface TeamReminderGroup {
  teamId: number;
  teamName: string;
  totalActiveMembers: number;
  missingCount: number;
  qualifiedCount: number;
  missingAthletes: ReminderAthleteInfo[];
}

export interface WeeklyActivityReminderResult {
  weekNumber: number;
  weekName: string;
  minKm: number;
  totalCompanyUsers: number;
  totalMissingUsers: number;
  totalQualifiedUsers: number;
  teams: TeamReminderGroup[];
}

export interface ReminderQueryOptions {
  week?: number | string | null;
  minKm?: number | string | null;
  teamId?: number | null;
}

/**
 * Parses week parameter and returns 1-4, defaults to Week 3 if out of range/unspecified
 */
export function resolveWeekNumber(weekParam?: number | string | null): number {
  if (weekParam !== undefined && weekParam !== null && weekParam !== '') {
    const raw = String(weekParam).trim().toLowerCase();
    const match = raw.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (parsed >= 1 && parsed <= 4) return parsed;
    }
  }

  // Auto-detect current active week by current date
  const now = new Date();
  for (const w of WEEKS) {
    if (now >= w.start && now < w.end) {
      return w.week;
    }
  }

  return 3; // Default fallback to Week 3
}

/**
 * Scans all legit activities in a given week and finds athletes who DO NOT have ANY single activity >= minKm.
 */
export async function getWeeklyActivityReminderList(options?: ReminderQueryOptions): Promise<WeeklyActivityReminderResult> {
  const weekNumber = resolveWeekNumber(options?.week);
  const weekObj = WEEKS[weekNumber - 1] || WEEKS[2];

  let minKm = 3.0;
  if (options?.minKm !== undefined && options?.minKm !== null && options?.minKm !== '') {
    const parsedMin = parseFloat(String(options.minKm).replace(/[^\d.]/g, ''));
    if (!isNaN(parsedMin) && parsedMin > 0) {
      minKm = parsedMin;
    }
  }

  const [users, exemptUserIds] = await Promise.all([
    db.user.findMany({
      orderBy: { teamId: 'asc' }
    }),
    getExemptUserIdsForWeek(weekNumber)
  ]);

  // Fetch all legit activities in that week
  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      startDate: {
        gte: weekObj.start,
        lt: weekObj.end
      }
    }
  });

  // Group activities by user
  const userActivitiesMap = new Map<string, { runCount: number; totalMeters: number; maxMeters: number }>();
  users.forEach(u => {
    userActivitiesMap.set(u.id, { runCount: 0, totalMeters: 0, maxMeters: 0 });
  });

  activities.forEach(act => {
    const current = userActivitiesMap.get(act.userId) || { runCount: 0, totalMeters: 0, maxMeters: 0 };
    current.runCount += 1;
    current.totalMeters += act.distance;
    if (act.distance > current.maxMeters) {
      current.maxMeters = act.distance;
    }
    userActivitiesMap.set(act.userId, current);
  });

  const minMeters = minKm * 1000;
  let totalActiveCompanyUsers = 0;
  let totalMissingUsers = 0;
  let totalQualifiedUsers = 0;

  const targetTeams = options?.teamId 
    ? TEAMS.filter(t => t.id === options.teamId)
    : TEAMS;

  const teamGroups: TeamReminderGroup[] = targetTeams.map(team => {
    // Exclude exempt users from reminders
    const teamUsers = users.filter(u => u.teamId === team.id && !exemptUserIds.has(u.id));
    const totalActiveMembers = teamUsers.length;
    totalActiveCompanyUsers += totalActiveMembers;

    const missingAthletes: ReminderAthleteInfo[] = [];
    let qualifiedCount = 0;

    teamUsers.forEach(u => {
      const stats = userActivitiesMap.get(u.id) || { runCount: 0, totalMeters: 0, maxMeters: 0 };
      const maxKm = stats.maxMeters / 1000;
      const totalKm = stats.totalMeters / 1000;

      if (stats.maxMeters >= minMeters) {
        qualifiedCount += 1;
        totalQualifiedUsers += 1;
      } else {
        totalMissingUsers += 1;
        missingAthletes.push({
          id: u.id,
          nickName: u.nickName,
          fullName: u.fullName,
          gender: u.gender,
          department: u.department,
          teamId: team.id,
          teamName: team.name,
          runCountInWeek: stats.runCount,
          totalDistanceInWeekKm: totalKm,
          maxSingleActivityKm: maxKm
        });
      }
    });

    // Sort missing athletes: 0 runs first, then lowest maxSingleActivityKm
    missingAthletes.sort((a, b) => {
      if (a.runCountInWeek !== b.runCountInWeek) {
        return a.runCountInWeek - b.runCountInWeek;
      }
      return a.maxSingleActivityKm - b.maxSingleActivityKm;
    });

    return {
      teamId: team.id,
      teamName: team.name,
      totalActiveMembers,
      missingCount: missingAthletes.length,
      qualifiedCount,
      missingAthletes
    };
  });

  return {
    weekNumber,
    weekName: weekObj.name,
    minKm,
    totalCompanyUsers: totalActiveCompanyUsers,
    totalMissingUsers,
    totalQualifiedUsers,
    teams: teamGroups
  };
}
