import * as XLSX from 'xlsx';
import { db } from '../config/db';
import { env } from '../config/env';
import { getTeamName } from './team.service';
import { formatVietnamDateTime, formatPace } from './telegram.service';

const week1StartDate = env.ALLOW_TEST_DATE ? new Date('2026-07-01T00:00:00+07:00') : new Date('2026-08-03T00:00:00+07:00');

const WEEK_RANGES: Record<string, { start: Date; end: Date; name: string }> = {
  tuan1: {
    start: week1StartDate,
    end: new Date('2026-08-09T23:59:59+07:00'),
    name: 'Tuần 1 (03/08 - 09/08)'
  },
  tuan2: {
    start: new Date('2026-08-10T00:00:00+07:00'),
    end: new Date('2026-08-16T23:59:59+07:00'),
    name: 'Tuần 2 (10/08 - 16/08)'
  },
  tuan3: {
    start: new Date('2026-08-17T00:00:00+07:00'),
    end: new Date('2026-08-23T23:59:59+07:00'),
    name: 'Tuần 3 (17/08 - 23/08)'
  },
  tuan4: {
    start: new Date('2026-08-24T00:00:00+07:00'),
    end: new Date('2026-08-30T23:59:59+07:00'),
    name: 'Tuần 4 (24/08 - 30/08)'
  }
};

export interface ExcelExportResult {
  buffer: Buffer;
  filename: string;
  totalRecords: number;
  filterTitle: string;
}

/**
 * Generates an Excel (.xlsx) Buffer containing violation/flagged activities based on optional filters.
 */
export async function exportViolationsToExcelBuffer(param?: string): Promise<ExcelExportResult> {
  const cleanParam = (param || 'tatca').trim().toLowerCase();
  let filterTitle = 'Tất cả các bài vi phạm từ đầu giải';
  let dateWhere: any = {};
  let userWhere: any = {};

  if (WEEK_RANGES[cleanParam]) {
    const week = WEEK_RANGES[cleanParam];
    filterTitle = `Các bài vi phạm trong ${week.name}`;
    dateWhere = {
      startDate: {
        gte: week.start,
        lte: week.end
      }
    };
  } else if (/^doi[1-8]$/.test(cleanParam)) {
    const teamNum = parseInt(cleanParam.replace('doi', ''), 10);
    filterTitle = `Các bài vi phạm thuộc Đội ${teamNum}`;
    userWhere = { teamId: teamNum };
  } else if (cleanParam !== 'tatca' && cleanParam !== 'all') {
    filterTitle = `Các bài vi phạm của VĐV khớp từ khóa "${param}"`;
    userWhere = {
      OR: [
        { nickName: { contains: param, mode: 'insensitive' } },
        { fullName: { contains: param, mode: 'insensitive' } }
      ]
    };
  }

  const activities = await db.activity.findMany({
    where: {
      isLegit: false,
      ...dateWhere,
      user: userWhere
    },
    include: { user: true },
    orderBy: { startDate: 'desc' }
  });

  const rows = activities.map((act, index) => {
    const distKm = (act.distance / 1000).toFixed(2);
    const movingMin = (act.movingTime / 60).toFixed(1);

    const paceSec = act.distance > 0 ? act.movingTime / (act.distance / 1000) : 0;
    const maxSpeedKmH = (act.maxSpeed * 3.6).toFixed(1);
    const dateFormatted = formatVietnamDateTime(act.startDate);

    const rpm = act.averageCadence || 0;
    const spm = Math.round(rpm * 2);
    const hr = (act as any).averageHeartrate ? `${Math.round((act as any).averageHeartrate)} bpm` : (act.hasHeartrate ? 'Có' : 'Không');

    return {
      'STT': index + 1,
      'Activity ID (Dán vào /duyet)': String(act.stravaActivityId),
      'Họ và Tên VĐV': act.user.fullName || act.user.nickName,
      'Nickname': act.user.nickName,
      'Giới tính': act.user.gender === 'FEMALE' ? 'Nữ' : 'Nam',
      'Đội thi đấu': getTeamName(act.user.teamId),
      'Phòng Ban': act.user.department || 'N/A',
      'Ngày giờ chạy (UTC+7)': dateFormatted,
      'Tên bài chạy': act.name,
      'Quãng đường (km)': parseFloat(distKm),
      'Thời gian (phút)': parseFloat(movingMin),
      'Pace (min/km)': formatPace(paceSec),
      'Max Speed (km/h)': parseFloat(maxSpeedKmH),
      'Thiết bị (Device)': act.deviceName || 'N/A',
      'Bước chân (Cadence)': spm > 0 ? `${spm} bước/phút` : 'Không có',
      'Nhịp tim (bpm)': hr,
      'Lý do vi phạm (Anti-Cheat)': act.flagReason || 'Chờ xác minh',
      'Link Strava': `https://www.strava.com/activities/${act.stravaActivityId}`
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet['!cols'] = [
    { wch: 6 },   // STT
    { wch: 22 },  // Activity ID
    { wch: 24 },  // Họ tên
    { wch: 18 },  // Nickname
    { wch: 10 },  // Giới tính
    { wch: 30 },  // Đội
    { wch: 20 },  // Phòng ban
    { wch: 22 },  // Ngày giờ
    { wch: 30 },  // Tên bài
    { wch: 16 },  // Quãng đường
    { wch: 16 },  // Thời gian
    { wch: 14 },  // Pace
    { wch: 16 },  // Max speed
    { wch: 24 },  // Thiết bị
    { wch: 20 },  // Bước chân
    { wch: 18 },  // Nhịp tim
    { wch: 55 },  // Lý do vi phạm
    { wch: 45 }   // Link Strava
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bai_Vi_Pham');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const nowStr = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(/\//g, '_');
  const filename = `DANH_SACH_VI_PHAM_${cleanParam.toUpperCase()}_${nowStr}.xlsx`;

  return {
    buffer,
    filename,
    totalRecords: activities.length,
    filterTitle
  };
}

/**
 * Generates an Excel (.xlsx) Buffer containing Leaderboard / User Rankings for ALL users.
 * Supports filtering by Week ('tuan1', 'tuan2', 'tuan3', 'tuan4', 'tatca') AND minimum distance per activity (e.g. minKm = 3).
 */
export async function exportLeaderboardToExcelBuffer(param?: string, minKmParam?: number | string): Promise<ExcelExportResult> {
  let cleanParam = (param || 'tatca').trim().toLowerCase();
  
  // Extract minKm from minKmParam or from within param string (e.g. "tuan3 3", "3 3", "tuan3 min 3", "3km")
  let minKm: number | null = null;

  if (minKmParam !== undefined && minKmParam !== null && minKmParam !== '') {
    const parsed = parseFloat(String(minKmParam).trim().replace(/[^\d.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      minKm = parsed;
    }
  }

  // Also check if minKm is embedded inside param string (e.g. "tuan3 3", "tuan3 3km", "tuan3 >3")
  const paramParts = cleanParam.split(/\s+/);
  if (paramParts.length >= 2) {
    cleanParam = paramParts[0];
    if (minKm === null) {
      const matchMin = paramParts.slice(1).join(' ').match(/(\d+(?:\.\d+)?)/);
      if (matchMin) {
        const parsed = parseFloat(matchMin[1]);
        if (!isNaN(parsed) && parsed > 0) {
          minKm = parsed;
        }
      }
    }
  }

  cleanParam = cleanParam.replace(/[\s_]+/g, '');
  if (cleanParam === '1' || cleanParam === 'w1' || cleanParam === 'tuần1') cleanParam = 'tuan1';
  if (cleanParam === '2' || cleanParam === 'w2' || cleanParam === 'tuần2') cleanParam = 'tuan2';
  if (cleanParam === '3' || cleanParam === 'w3' || cleanParam === 'tuần3') cleanParam = 'tuan3';
  if (cleanParam === '4' || cleanParam === 'w4' || cleanParam === 'tuần4') cleanParam = 'tuan4';

  let filterTitle = 'Bảng Xếp Hạng Toàn Bộ VĐV (Cả Giải)';
  const selectedWeek = WEEK_RANGES[cleanParam];

  if (selectedWeek) {
    filterTitle = `Bảng Xếp Hạng VĐV trong ${selectedWeek.name}`;
  }
  if (minKm !== null && minKm > 0) {
    filterTitle += ` [Chỉ tính bài chạy >= ${minKm.toFixed(1)} km]`;
  }

  const users = await db.user.findMany({
    orderBy: { teamId: 'asc' }
  });

  let userStatsMap = new Map<string, { totalDistanceMeters: number; validCount: number; totalMovingTimeSec: number }>();

  const distanceCondition = minKm !== null && minKm > 0 ? { distance: { gte: minKm * 1000 } } : {};

  if (selectedWeek) {
    // Group legit activities within week window with distance condition
    const activities = await db.activity.findMany({
      where: {
        isLegit: true,
        startDate: { gte: selectedWeek.start, lte: selectedWeek.end },
        ...distanceCondition
      }
    });

    activities.forEach(act => {
      const current = userStatsMap.get(act.userId) || { totalDistanceMeters: 0, validCount: 0, totalMovingTimeSec: 0 };
      current.totalDistanceMeters += act.distance;
      current.validCount += 1;
      current.totalMovingTimeSec += act.movingTime;
      userStatsMap.set(act.userId, current);
    });
  } else {
    // Whole contest aggregated stats with distance condition
    const activitiesGrouped = await db.activity.groupBy({
      by: ['userId'],
      where: {
        isLegit: true,
        ...distanceCondition
      },
      _sum: { distance: true, movingTime: true },
      _count: { id: true }
    });

    activitiesGrouped.forEach(g => {
      userStatsMap.set(g.userId, {
        totalDistanceMeters: g._sum.distance || 0,
        validCount: g._count.id || 0,
        totalMovingTimeSec: g._sum.movingTime || 0
      });
    });
  }

  // Build combined leaderboard data
  const leaderboardList = users.map(user => {
    const stats = userStatsMap.get(user.id) || { totalDistanceMeters: 0, validCount: 0, totalMovingTimeSec: 0 };
    const distKm = stats.totalDistanceMeters / 1000;
    const avgPaceSec = distKm > 0 ? stats.totalMovingTimeSec / distKm : 0;
    const targetKm = user.gender === 'FEMALE' ? 15 : 30;
    const isTargetReached = user.totalDistance >= (targetKm * 1000);

    return {
      user,
      totalKm: distKm,
      validCount: stats.validCount,
      avgPaceSec,
      targetKm,
      isTargetReached
    };
  }).sort((a, b) => {
    if (Math.abs(b.totalKm - a.totalKm) > 0.001) {
      return b.totalKm - a.totalKm;
    }
    return a.avgPaceSec - b.avgPaceSec;
  });

  const distColHeader = minKm !== null && minKm > 0 ? `Tổng Quãng đường (km) (Bài >= ${minKm}km)` : 'Tổng Quãng đường (km)';
  const countColHeader = minKm !== null && minKm > 0 ? `Số bài hợp lệ (>= ${minKm}km)` : 'Số bài chạy hợp lệ';

  const rows = leaderboardList.map((item, index) => {
    const u = item.user;
    return {
      'Hạng (Rank)': index + 1,
      'Họ và Tên VĐV': u.fullName || u.nickName,
      'Nickname': u.nickName,
      'Giới tính': u.gender === 'FEMALE' ? 'Nữ' : 'Nam',
      'Đội thi đấu': getTeamName(u.teamId),
      'Phòng Ban': u.department || 'N/A',
      [distColHeader]: parseFloat(item.totalKm.toFixed(2)),
      [countColHeader]: item.validCount,
      'Pace trung bình': formatPace(item.avgPaceSec),
      'Chỉ tiêu cá nhân (km)': item.targetKm,
      'Trạng thái mốc chỉ tiêu': item.isTargetReached ? '⚡ Đã đạt' : '⏳ Chưa đạt',
      'Thời điểm cán mốc (UTC+7)': u.reachedTargetAt ? formatVietnamDateTime(u.reachedTargetAt) : 'Chưa đạt'
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet['!cols'] = [
    { wch: 12 },  // Rank
    { wch: 24 },  // Họ tên
    { wch: 18 },  // Nickname
    { wch: 10 },  // Giới tính
    { wch: 30 },  // Đội
    { wch: 20 },  // Phòng ban
    { wch: 26 },  // Tổng km
    { wch: 22 },  // Số bài hợp lệ
    { wch: 16 },  // Pace
    { wch: 20 },  // Chỉ tiêu km
    { wch: 22 },  // Trạng thái mốc
    { wch: 24 }   // Thời điểm cán mốc
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bang_Xep_Hang');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const nowStr = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(/\//g, '_');
  const minKmTag = minKm !== null && minKm > 0 ? `_MIN_${minKm}KM` : '';
  const filename = `BANG_XEP_HANG_${cleanParam.toUpperCase()}${minKmTag}_${nowStr}.xlsx`;

  return {
    buffer,
    filename,
    totalRecords: leaderboardList.length,
    filterTitle
  };
}
