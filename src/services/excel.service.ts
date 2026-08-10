import * as XLSX from 'xlsx';
import { db } from '../config/db';

import { env } from '../config/env';

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
 * Filters supported:
 * - 'tatca' or empty: All violations
 * - 'tuan1', 'tuan2', 'tuan3', 'tuan4': Specific week date window
 * - 'doi1', 'doi2'...'doi8': Specific Team ID
 * - Any string: Search by user Nickname or Full Name
 */
export async function exportViolationsToExcelBuffer(param?: string): Promise<ExcelExportResult> {
  const cleanParam = (param || 'tatca').trim().toLowerCase();
  let filterTitle = 'Tất cả các bài vi phạm từ đầu giải';
  let dateWhere: any = {};
  let userWhere: any = {};

  // 1. Check if filter is by Week (tuan1 -> tuan4)
  if (WEEK_RANGES[cleanParam]) {
    const week = WEEK_RANGES[cleanParam];
    filterTitle = `Các bài vi phạm trong ${week.name}`;
    dateWhere = {
      startDate: {
        gte: week.start,
        lte: week.end
      }
    };
  }
  // 2. Check if filter is by Team (doi1 -> doi8)
  else if (/^doi[1-8]$/.test(cleanParam)) {
    const teamNum = parseInt(cleanParam.replace('doi', ''), 10);
    filterTitle = `Các bài vi phạm thuộc Đội ${teamNum}`;
    userWhere = { teamId: teamNum };
  }
  // 3. Check if filter is by Nickname or Name
  else if (cleanParam !== 'tatca' && cleanParam !== 'all') {
    filterTitle = `Các bài vi phạm của VĐV khớp từ khóa "${param}"`;
    userWhere = {
      OR: [
        { nickName: { contains: param, mode: 'insensitive' } },
        { fullName: { contains: param, mode: 'insensitive' } }
      ]
    };
  }

  // Query database for non-legit activities matching filters
  const activities = await db.activity.findMany({
    where: {
      isLegit: false,
      ...dateWhere,
      user: userWhere
    },
    include: { user: true },
    orderBy: { startDate: 'desc' }
  });

  // Prepare Excel rows
  const rows = activities.map((act, index) => {
    const distKm = (act.distance / 1000).toFixed(2);
    const movingMin = (act.movingTime / 60).toFixed(1);

    const paceSec = act.distance > 0 ? act.movingTime / (act.distance / 1000) : 0;
    const paceMinStr = Math.floor(paceSec / 60);
    const paceSecStr = Math.round(paceSec % 60);
    const paceFormatted = `${paceMinStr}:${paceSecStr < 10 ? '0' : ''}${paceSecStr}`;

    const maxSpeedKmH = (act.maxSpeed * 3.6).toFixed(1);
    const dateFormatted = new Date(act.startDate).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const rpm = act.averageCadence || 0;
    const spm = Math.round(rpm * 2);
    const hr = (act as any).averageHeartrate ? `${Math.round((act as any).averageHeartrate)} bpm` : (act.hasHeartrate ? 'Có' : 'Không');

    return {
      'STT': index + 1,
      'Activity ID (Dán vào /duyet)': String(act.stravaActivityId),
      'Họ và Tên VĐV': act.user.fullName || act.user.nickName,
      'Nickname': act.user.nickName,
      'Giới tính': act.user.gender === 'FEMALE' ? 'Nữ' : 'Nam',
      'Đội thi đấu': `Đội ${act.user.teamId}`,
      'Phòng Ban': act.user.department || 'N/A',
      'Ngày giờ chạy (UTC+7)': dateFormatted,
      'Tên bài chạy': act.name,
      'Quãng đường (km)': parseFloat(distKm),
      'Thời gian (phút)': parseFloat(movingMin),
      'Pace (min/km)': paceFormatted,
      'Max Speed (km/h)': parseFloat(maxSpeedKmH),
      'Thiết bị (Device)': act.deviceName || 'N/A',
      'Bước chân (Cadence)': spm > 0 ? `${spm} bước/phút` : 'Không có',
      'Nhịp tim (bpm)': hr,
      'Lý do vi phạm (Anti-Cheat)': act.flagReason || 'Chờ xác minh',
      'Link Strava': `https://www.strava.com/activities/${act.stravaActivityId}`
    };
  });

  // Create Worksheet & Workbook using SheetJS
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Set column widths for readability
  worksheet['!cols'] = [
    { wch: 6 },   // STT
    { wch: 22 },  // Activity ID
    { wch: 24 },  // Họ tên
    { wch: 18 },  // Nickname
    { wch: 10 },  // Giới tính
    { wch: 12 },  // Đội
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
