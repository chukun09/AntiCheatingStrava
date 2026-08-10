import axios from 'axios';
import * as XLSX from 'xlsx';
import path from 'path';
import { db } from './config/db';
import { getValidAccessToken } from './services/strava.service';

const CLUB_ID = '2276487';
// Contest Start Date: 00:00:00 03/08/2026 Vietnam Time (UTC+7)
const CONTEST_START_DATE = new Date('2026-08-03T00:00:00+07:00');

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const hStr = hrs > 0 ? `${hrs.toString().padStart(2, '0')}:` : '';
  return `${hStr}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatPace(movingTimeSec: number, distanceMeters: number): string {
  if (!distanceMeters || distanceMeters <= 0 || !movingTimeSec) return 'N/A';
  const secPerKm = movingTimeSec / (distanceMeters / 1000);
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

async function exportClubApiActivities() {
  console.log(`====================================================`);
  console.log(`🚀 CÀO TRỰC TIẾP STRAVA CLUB API (${CLUB_ID}) TỪ 00:00 03/08/2026 (UTC+7)...`);
  console.log(`====================================================`);

  // 1. Get valid access token from DB
  const users = await db.user.findMany({ where: { accessToken: { not: null } } });
  if (users.length === 0) {
    console.error('❌ Không tìm thấy Token trong CSDL.');
    process.exit(1);
  }

  let accessToken: string | null = null;
  for (const u of users) {
    accessToken = await getValidAccessToken(u);
    if (accessToken) {
      console.log(`🔑 Dùng Access Token của VĐV: ${u.nickName}`);
      break;
    }
  }

  if (!accessToken) {
    console.error('❌ Không thể lấy Access Token hợp lệ.');
    process.exit(1);
  }

  // 2. Fetch all pages of club activities
  let rawClubActivities: any[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    console.log(`🌐 Gọi Strava Club API Page ${page}...`);
    try {
      const url = `https://www.strava.com/api/v3/clubs/${CLUB_ID}/activities?page=${page}&per_page=${perPage}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const items: any[] = response.data || [];
      console.log(`   Nhận ${items.length} bài chạy ở Page ${page}.`);

      if (items.length === 0) break;
      rawClubActivities.push(...items);

      if (items.length < perPage) break;
      page++;
    } catch (error: any) {
      console.error(`❌ Lỗi khi gọi Strava API Page ${page}:`, error?.response?.data || error.message);
      break;
    }
  }

  console.log(`\n📊 Tổng số bài chạy lấy từ Strava Club API: ${rawClubActivities.length} bài.`);

  // 3. Filter activities strictly starting from 00:00:00 03/08/2026 (Vietnam Time UTC+7)
  const filteredActivities = rawClubActivities.filter(act => {
    const actDate = new Date(act.start_date_local || act.start_date);
    return actDate >= CONTEST_START_DATE;
  });

  console.log(`⚡ Bài chạy thỏa mãn từ 00:00 03/08/2026 (UTC+7) trở đi: ${filteredActivities.length} bài.`);

  // 4. Map activities to Excel rows
  const excelRows = filteredActivities.map((act, index) => {
    const distanceKm = Number(((act.distance || 0) / 1000).toFixed(2));
    const movingTimeSec = act.moving_time || 0;
    const elapsedTimeSec = act.elapsed_time || 0;
    const avgSpeedKmH = Number(((act.average_speed || 0) * 3.6).toFixed(2));
    const maxSpeedKmH = Number(((act.max_speed || 0) * 3.6).toFixed(2));
    const paceStr = formatPace(movingTimeSec, act.distance || 0);

    const athleteFirstName = act.athlete?.firstname || '';
    const athleteLastName = act.athlete?.lastname || '';
    const athleteFullName = `${athleteFirstName} ${athleteLastName}`.trim() || 'VĐV Strava';

    const startDateVN = new Date(act.start_date_local || act.start_date);
    const dateFormatted = startDateVN.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    return {
      'STT': index + 1,
      'ID Bài Chạy': String(act.id || ''),
      'Vận Động Viên (Strava Name)': athleteFullName,
      'Tên Bài Chạy': act.name || 'Untitled',
      'Loại Hình': act.sport_type || act.type || 'Run',
      'Quãng Đường (km)': distanceKm,
      'Thời Gian Di Chuyển': formatDuration(movingTimeSec),
      'Tổng Thời Gian': formatDuration(elapsedTimeSec),
      'Pace (min/km)': paceStr,
      'Tốc Độ TB (km/h)': avgSpeedKmH,
      'Tốc Độ Max (km/h)': maxSpeedKmH,
      'Độ Cao (m)': act.total_elevation_gain || 0,
      'Ngày Chạy (Giờ VN UTC+7)': dateFormatted,
      'Link Strava': `https://www.strava.com/activities/${act.id}`
    };
  });

  // Sort rows by Date descending (mới nhất lên đầu)
  excelRows.sort((a, b) => new Date(b['Ngày Chạy (Giờ VN UTC+7)']).getTime() - new Date(a['Ngày Chạy (Giờ VN UTC+7)']).getTime());
  excelRows.forEach((r, idx) => r['STT'] = idx + 1);

  // 5. Build Excel Sheet and Workbook
  const worksheet = XLSX.utils.json_to_sheet(excelRows);

  worksheet['!cols'] = [
    { wch: 6 },  // STT
    { wch: 15 }, // ID
    { wch: 28 }, // VĐV
    { wch: 35 }, // Tên bài
    { wch: 12 }, // Loại
    { wch: 18 }, // Km
    { wch: 20 }, // Moving Time
    { wch: 18 }, // Elapsed Time
    { wch: 15 }, // Pace
    { wch: 16 }, // Avg Speed
    { wch: 16 }, // Max Speed
    { wch: 12 }, // Elev
    { wch: 24 }, // Ngày chạy VN
    { wch: 45 }  // Link
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Strava Club 03-08');

  const outputPath = path.join(__dirname, `../STRAVA_CLUB_2276487_TUDIEN_03_08.xlsx`);
  XLSX.writeFile(workbook, outputPath);

  console.log(`\n====================================================`);
  console.log(`🎉 XUẤT EXCEL THÀNH CÔNG!`);
  console.log(`📁 File lưu tại: ${outputPath}`);
  console.log(`====================================================`);
  process.exit(0);
}

exportClubApiActivities();
