import { db } from '../config/db';
import { WEEKS } from './awards.service';
import { findUserByFlexibleQuery } from './bonus.service';
import { getTeamName } from './team.service';
import { formatPace, formatVietnamDateTime } from './telegram.service';

export interface UserVersusProfile {
  id: string;
  nickName: string;
  fullName: string | null;
  teamId: number;
  teamName: string;
  department: string | null;
  gender: string;
  week4Km: number;
  week4RunCount: number;
  week4AvgPaceSec: number;
  wholeContestKm: number;
  latestActivity?: {
    distanceKm: number;
    startDate: Date;
    avgPaceSec: number;
  };
}

export interface UserVersusResult {
  success: boolean;
  message?: string;
  athlete1?: UserVersusProfile;
  athlete2?: UserVersusProfile;
  diffKm?: number;
  leadingAthlete?: 'athlete1' | 'athlete2' | 'tie';
  formattedTelegramText?: string;
}

/**
 * Compare Week 4 performance between 2 athletes (defaults to MrChoi vs IRIS JOSEPH)
 */
export async function compareAthletesWeek4(
  query1: string = 'MrChoi',
  query2: string = 'IRIS JOSEPH'
): Promise<UserVersusResult> {
  const [user1, user2] = await Promise.all([
    findUserByFlexibleQuery(query1),
    findUserByFlexibleQuery(query2)
  ]);

  if (!user1) {
    return {
      success: false,
      message: `❌ Không tìm thấy VĐV thứ nhất khớp với từ khóa <b>"${query1}"</b>.`
    };
  }

  if (!user2) {
    return {
      success: false,
      message: `❌ Không tìm thấy VĐV thứ hai khớp với từ khóa <b>"${query2}"</b>.`
    };
  }

  if (user1.id === user2.id) {
    return {
      success: false,
      message: `⚠️ Hai từ khóa cùng trỏ về 1 VĐV (<b>${user1.fullName || user1.nickName}</b>). Vui lòng chọn 2 VĐV khác nhau để so kèo!`
    };
  }

  const week4 = WEEKS[3] || WEEKS[WEEKS.length - 1];

  // Fetch activities for both users in Week 4
  const activities = await db.activity.findMany({
    where: {
      userId: { in: [user1.id, user2.id] },
      isLegit: true,
      startDate: {
        gte: week4.start,
        lt: week4.end
      }
    },
    orderBy: { startDate: 'desc' }
  });

  const getProfile = (u: typeof user1): UserVersusProfile => {
    const userActs = activities.filter(a => a.userId === u.id);
    let totalDist = 0;
    let totalSec = 0;

    userActs.forEach(a => {
      totalDist += a.distance;
      totalSec += a.movingTime;
    });

    const distKm = totalDist / 1000;
    const avgPace = distKm > 0 && totalSec > 0 ? totalSec / distKm : Number.POSITIVE_INFINITY;
    const latest = userActs[0]
      ? {
          distanceKm: userActs[0].distance / 1000,
          startDate: userActs[0].startDate,
          avgPaceSec: (userActs[0].distance > 0 && userActs[0].movingTime > 0) ? userActs[0].movingTime / (userActs[0].distance / 1000) : 0
        }
      : undefined;

    return {
      id: u.id,
      nickName: u.nickName,
      fullName: u.fullName,
      teamId: u.teamId,
      teamName: getTeamName(u.teamId),
      department: u.department,
      gender: u.gender,
      week4Km: distKm,
      week4RunCount: userActs.length,
      week4AvgPaceSec: avgPace,
      wholeContestKm: u.totalDistance / 1000,
      latestActivity: latest
    };
  };

  const p1 = getProfile(user1);
  const p2 = getProfile(user2);

  const diffKm = Math.abs(p1.week4Km - p2.week4Km);
  const leadingAthlete: 'athlete1' | 'athlete2' | 'tie' =
    p1.week4Km > p2.week4Km ? 'athlete1' : p2.week4Km > p1.week4Km ? 'athlete2' : 'tie';

  const name1 = p1.fullName ? `${p1.fullName} (@${p1.nickName})` : `@${p1.nickName}`;
  const name2 = p2.fullName ? `${p2.fullName} (@${p2.nickName})` : `@${p2.nickName}`;

  const formatLatest = (latest?: UserVersusProfile['latestActivity']) => {
    if (!latest) return '<i>Chưa có bài chạy Tuần 4</i>';
    const dateStr = formatVietnamDateTime(latest.startDate);
    const pace = formatPace(latest.avgPaceSec);
    return `<b>+${latest.distanceKm.toFixed(2)} km</b> (Pace ${pace} | ${dateStr})`;
  };

  let leaderText = '';
  if (leadingAthlete === 'tie') {
    leaderText = `🤝 <b>KẾT QUẢ ĐỐI ĐẦU:</b> Hai VĐV đang BẰNG NHAU (<b>${p1.week4Km.toFixed(2)} km</b>)`;
  } else {
    const leader = leadingAthlete === 'athlete1' ? p1 : p2;
    const chaser = leadingAthlete === 'athlete1' ? p2 : p1;
    leaderText = 
`🏆 <b>ĐANG DẪN ĐẦU:</b> 🥇 <b>${leader.fullName || leader.nickName}</b>
⚡ <b>Cách biệt:</b> <code>+${diffKm.toFixed(2)} km</code> (Hơn ${chaser.fullName || chaser.nickName})`;
  }

  const text = 
`🥊 <b>ĐẠI CHIẾN SOLO TUẦN 4: VỀ ĐÍCH</b> 🥊
⏱ <i>Cập nhật: ${formatVietnamDateTime(new Date())}</i>
━━━━━━━━━━━━━━━━━━━━

🔵 <b>VĐV 1: ${name1}</b>
   🏢 ${p1.teamName} ${p1.department ? `• ${p1.department}` : ''}
   🏃 <b>Tổng Tuần 4:</b> <code>${p1.week4Km.toFixed(2)} km</code> (${p1.week4RunCount} bài)
   ⚡ <b>Pace TB Tuần 4:</b> <code>${formatPace(p1.week4AvgPaceSec)}</code>
   🏃‍♂️ <b>Tổng Cả Giải:</b> <code>${p1.wholeContestKm.toFixed(2)} km</code>
   🕒 <b>Bài gần nhất:</b> ${formatLatest(p1.latestActivity)}

🔴 <b>VĐV 2: ${name2}</b>
   🏢 ${p2.teamName} ${p2.department ? `• ${p2.department}` : ''}
   🏃 <b>Tổng Tuần 4:</b> <code>${p2.week4Km.toFixed(2)} km</code> (${p2.week4RunCount} bài)
   ⚡ <b>Pace TB Tuần 4:</b> <code>${formatPace(p2.week4AvgPaceSec)}</code>
   🏃‍♂️ <b>Tổng Cả Giải:</b> <code>${p2.wholeContestKm.toFixed(2)} km</code>
   🕒 <b>Bài gần nhất:</b> ${formatLatest(p2.latestActivity)}

━━━━━━━━━━━━━━━━━━━━
${leaderText}
`;

  return {
    success: true,
    athlete1: p1,
    athlete2: p2,
    diffKm,
    leadingAthlete,
    formattedTelegramText: text
  };
}
