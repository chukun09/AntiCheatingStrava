import { db } from '../config/db';
import { TEAMS } from './team.service';
import { env } from '../config/env';

// If ALLOW_TEST_DATE=true, expand Week 1 start date back to 2026-07-01 so test runs show up on leaderboards
const week1StartDate = env.ALLOW_TEST_DATE ? new Date('2026-07-01T00:00:00+07:00') : new Date('2026-08-03T00:00:00+07:00');

export const WEEKS = [
  { week: 1, name: 'Tuần 1: Khởi động', start: week1StartDate, end: new Date('2026-08-10T00:00:00+07:00') },
  { week: 2, name: 'Tuần 2: Vượt chướng ngại vật', start: new Date('2026-08-10T00:00:00+07:00'), end: new Date('2026-08-17T00:00:00+07:00') },
  { week: 3, name: 'Tuần 3: Tăng tốc & Bứt phá', start: new Date('2026-08-17T00:00:00+07:00'), end: new Date('2026-08-24T00:00:00+07:00') },
  { week: 4, name: 'Tuần 4: Về đích', start: new Date('2026-08-24T00:00:00+07:00'), end: new Date('2026-08-31T00:00:00+07:00') }
];

/**
 * Tuần 1: Giải Tập Thể Khởi Động - Tỷ lệ % tham gia (>= 3km) cao nhất
 */
export async function getWeek1TeamAward() {
  const week1 = WEEKS[0];
  const users = await db.user.findMany();

  // Get total distance per user in Week 1
  const userDistances = await db.activity.groupBy({
    by: ['userId'],
    where: {
      isLegit: true,
      startDate: { gte: week1.start, lt: week1.end }
    },
    _sum: { distance: true }
  });

  const distanceMap = new Map(userDistances.map(d => [d.userId, (d._sum.distance || 0) / 1000]));

  return TEAMS.map(team => {
    const teamMembers = users.filter(u => u.teamId === team.id);
    const totalMembers = teamMembers.length;

    let totalDistanceKmWeek1 = 0;
    let qualifiedMembers = 0;
    let qualified5KmMembers = 0;

    teamMembers.forEach(u => {
      const dist = distanceMap.get(u.id) || 0;
      totalDistanceKmWeek1 += dist;
      if (dist >= 3.0) qualifiedMembers++;
      if (dist >= 5.0) qualified5KmMembers++;
    });

    const participationRate = totalMembers > 0 ? (qualifiedMembers / totalMembers) * 100 : 0;
    const avgKmPerActiveParticipant = qualifiedMembers > 0 ? totalDistanceKmWeek1 / qualifiedMembers : 0;

    return {
      teamId: team.id,
      teamName: team.name,
      totalMembers,
      qualifiedMembers,
      qualified5KmMembers,
      participationRate,
      totalDistanceKmWeek1,
      avgKmPerActiveParticipant
    };
  }).sort((a, b) => {
    // Tier 1: Primary - Participation Rate (%)
    if (Math.abs(b.participationRate - a.participationRate) > 0.001) {
      return b.participationRate - a.participationRate;
    }
    // Tier 2: Secondary Tie-breaker 1 - Total Distance in Week 1 (km)
    if (Math.abs(b.totalDistanceKmWeek1 - a.totalDistanceKmWeek1) > 0.01) {
      return b.totalDistanceKmWeek1 - a.totalDistanceKmWeek1;
    }
    // Tier 3: Secondary Tie-breaker 2 - Average Distance per Active Participant (km/person)
    if (Math.abs(b.avgKmPerActiveParticipant - a.avgKmPerActiveParticipant) > 0.01) {
      return b.avgKmPerActiveParticipant - a.avgKmPerActiveParticipant;
    }
    // Tier 4: Secondary Tie-breaker 3 - Number of members completing >= 5km
    return b.qualified5KmMembers - a.qualified5KmMembers;
  });
}

/**
 * Tuần 2: Giải Tập Thể Vượt Chướng Ngại Vật - Pace tốt nhất (Ưu đãi Nữ: giảm 1 min/km ~ 60s/km)
 * Điều kiện cần: 100% thành viên đội đã tham gia (chạy >= 1 bài hợp lệ trong Tuần 2)
 */
export async function getWeek2TeamAward() {
  const week2 = WEEKS[1];
  const users = await db.user.findMany();

  const activities = await db.activity.findMany({
    where: {
      isLegit: true,
      startDate: { gte: week2.start, lt: week2.end }
    },
    include: { user: true }
  });

  // Group activities by teamId once
  const teamActivitiesMap = new Map<number, typeof activities>();
  activities.forEach(a => {
    const teamId = a.user.teamId;
    if (!teamActivitiesMap.has(teamId)) {
      teamActivitiesMap.set(teamId, []);
    }
    teamActivitiesMap.get(teamId)!.push(a);
  });

  return TEAMS.map(team => {
    const teamMembers = users.filter(u => u.teamId === team.id);
    const totalMembers = teamMembers.length;

    const teamActs = teamActivitiesMap.get(team.id) || [];
    const participantSet = new Set(teamActs.map(a => a.userId));
    const participantCount = participantSet.size;
    const is100PercentParticipated = totalMembers > 0 && participantCount >= totalMembers;

    let totalAdjustedSec = 0;
    let totalDistanceKm = 0;

    teamActs.forEach(a => {
      const distKm = a.distance / 1000;
      let movingSec = a.movingTime;

      if (a.user.gender === 'FEMALE') {
        const perkSec = distKm * 60;
        movingSec = Math.max(0, movingSec - perkSec);
      }

      totalAdjustedSec += movingSec;
      totalDistanceKm += distKm;
    });

    const averagePaceSecPerKm = totalDistanceKm > 0 ? totalAdjustedSec / totalDistanceKm : Number.POSITIVE_INFINITY;

    return {
      teamId: team.id,
      teamName: team.name,
      totalMembers,
      participantCount,
      is100PercentParticipated,
      totalDistanceKm,
      averagePaceSecPerKm
    };
  }).sort((a, b) => {
    if (a.is100PercentParticipated !== b.is100PercentParticipated) {
      return a.is100PercentParticipated ? -1 : 1;
    }
    return a.averagePaceSecPerKm - b.averagePaceSecPerKm;
  });
}

/**
 * Tuần 3: Giải Cá Nhân Bứt Phá Giới Hạn - Quãng đường Tuần 3 cao nhất (Nam & Nữ)
 */
export async function getWeek3IndividualAward() {
  const week3 = WEEKS[2];

  const maleStats = await db.activity.groupBy({
    by: ['userId'],
    where: {
      isLegit: true,
      startDate: { gte: week3.start, lt: week3.end },
      user: { gender: 'MALE' }
    },
    _sum: { distance: true },
    orderBy: { _sum: { distance: 'desc' } },
    take: 5
  });

  const femaleStats = await db.activity.groupBy({
    by: ['userId'],
    where: {
      isLegit: true,
      startDate: { gte: week3.start, lt: week3.end },
      user: { gender: 'FEMALE' }
    },
    _sum: { distance: true },
    orderBy: { _sum: { distance: 'desc' } },
    take: 5
  });

  const userIds = [...maleStats.map(s => s.userId), ...femaleStats.map(s => s.userId)];
  const users = await db.user.findMany({ where: { id: { in: userIds } } });
  const userMap = new Map(users.map(u => [u.id, u]));

  return {
    males: maleStats.map(s => ({
      user: userMap.get(s.userId),
      totalKm: ((s._sum.distance || 0) / 1000)
    })).filter(m => m.user !== undefined),
    females: femaleStats.map(s => ({
      user: userMap.get(s.userId),
      totalKm: ((s._sum.distance || 0) / 1000)
    })).filter(f => f.user !== undefined)
  };
}

/**
 * Tuần 3: Giải Tập Thể Tăng Tốc - Avg Km / người cao nhất trong Tuần 3
 */
export async function getWeek3TeamAward() {
  const week3 = WEEKS[2];
  const users = await db.user.findMany();

  const userDistances = await db.activity.groupBy({
    by: ['userId'],
    where: {
      isLegit: true,
      startDate: { gte: week3.start, lt: week3.end }
    },
    _sum: { distance: true }
  });

  const distanceMap = new Map(userDistances.map(d => [d.userId, (d._sum.distance || 0) / 1000]));

  return TEAMS.map(team => {
    const teamMembers = users.filter(u => u.teamId === team.id);
    const totalMembers = teamMembers.length;
    let totalKmWeek3 = 0;

    teamMembers.forEach(u => {
      totalKmWeek3 += distanceMap.get(u.id) || 0;
    });

    const avgKmPerMember = totalMembers > 0 ? totalKmWeek3 / totalMembers : 0;

    return {
      teamId: team.id,
      teamName: team.name,
      totalMembers,
      totalKmWeek3,
      avgKmPerMember
    };
  }).sort((a, b) => b.avgKmPerMember - a.avgKmPerMember);
}

/**
 * Tuần 4: Giải Tập Thể Về Đích - Avg Km / người cao nhất của CẢ GIẢI
 */
export async function getWeek4TeamAward() {
  const contestStart = week1StartDate;
  const contestEnd = WEEKS[3].end;

  const users = await db.user.findMany();

  const userDistances = await db.activity.groupBy({
    by: ['userId'],
    where: {
      isLegit: true,
      startDate: { gte: contestStart, lt: contestEnd }
    },
    _sum: { distance: true }
  });

  const distanceMap = new Map(userDistances.map(d => [d.userId, (d._sum.distance || 0) / 1000]));

  return TEAMS.map(team => {
    const teamMembers = users.filter(u => u.teamId === team.id);
    const totalMembers = teamMembers.length;
    let totalKmWholeContest = 0;

    teamMembers.forEach(u => {
      totalKmWholeContest += distanceMap.get(u.id) ?? 0;
    });

    const avgKmPerMember = totalMembers > 0 ? totalKmWholeContest / totalMembers : 0;

    return {
      teamId: team.id,
      teamName: team.name,
      totalMembers,
      totalKmWholeContest,
      avgKmPerMember
    };
  }).sort((a, b) => b.avgKmPerMember - a.avgKmPerMember);
}
