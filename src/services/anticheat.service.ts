import { env } from '../config/env';

export interface ValidationResult {
  isLegit: boolean;
  reason?: string;
}

// Contest Start & End dates: 00:00 03/08/2026 -> 23:59 30/08/2026
const CONTEST_START = new Date('2026-08-03T00:00:00+07:00');
const CONTEST_END = new Date('2026-08-30T23:59:59+07:00');

export function validateActivity(activity: any): ValidationResult {
  // 0. Check Contest Date Window (Bypassed if ALLOW_TEST_DATE=true in .env for pre-contest testing)
  if (env.ALLOW_TEST_DATE) {
    console.log('[Anti-Cheat] ALLOW_TEST_DATE=true -> Bypassing contest start date window check for test activity.');
  } else {
    const activityDate = new Date(activity.start_date || activity.start_date_local || Date.now());
    if (activityDate < CONTEST_START || activityDate > CONTEST_END) {
      return {
        isLegit: false,
        reason: `Ngoài thời gian diễn ra cuộc thi (Hành trình IRIS: 03/08 - 30/08/2026)`
      };
    }
  }

  // 1. Check Activity Type (Only Run or TrailRun)
  const allowedTypes = ['Run', 'TrailRun'];
  if (!activity.type || !allowedTypes.includes(activity.type)) {
    return { 
      isLegit: false, 
      reason: `Loại vận động không hợp lệ: ${activity.type || 'Không xác định'} (Chỉ tính Run / TrailRun)` 
    };
  }

  // 2. Block Manual Entry
  if (activity.manual === true) {
    return { 
      isLegit: false, 
      reason: 'Bài chạy nhập thủ công (Manual Entry)' 
    };
  }

  // 3. Block missing GPS map data
  if (!activity.map || !activity.map.summary_polyline) {
    return { 
      isLegit: false, 
      reason: 'Bài chạy không có dữ liệu bản đồ GPS (Polyline summary missing)' 
    };
  }

  // Safe distance check
  if (!activity.distance || activity.distance <= 0) {
    return {
      isLegit: false,
      reason: 'Quãng đường không hợp lệ (<= 0m)'
    };
  }

  // 4. Block abnormal Max Speed (> 25 km/h ~ Pace 2:24 min/km)
  const maxSpeedKmH = (activity.max_speed || 0) * 3.6;
  if (maxSpeedKmH > 25.0) {
    return { 
      isLegit: false, 
      reason: `Tốc độ tối đa bất thường: ${maxSpeedKmH.toFixed(1)} km/h (Vượt ngưỡng 25.0 km/h)` 
    };
  }

  // 5. Block abnormal Average Pace (< 4:00 min/km ~ 240 seconds/km per IRIS Rules)
  const averagePaceSecPerKm = activity.moving_time / (activity.distance / 1000);
  if (averagePaceSecPerKm < 240) {
    const paceMin = Math.floor(averagePaceSecPerKm / 60);
    const paceSec = Math.round(averagePaceSecPerKm % 60);
    const paceStr = `${paceMin}:${paceSec < 10 ? '0' : ''}${paceSec}`;
    return { 
      isLegit: false, 
      reason: `Pace trung bình quá nhanh: ${paceStr} min/km (Nhanh hơn ngưỡng 4:00 min/km theo Thể lệ IRIS)` 
    };
  }

  // 6. Detect Fake GPX File Upload (Web simulation / Fake My Run)
  const noCadence = !activity.average_cadence || activity.average_cadence === 0;
  const noHeartRate = !activity.has_heartrate;
  const externalId = activity.external_id ? String(activity.external_id).toLowerCase() : '';
  const isGpxUploaded = externalId.endsWith('.gpx');

  if (noCadence && noHeartRate && isGpxUploaded) {
    return { 
      isLegit: false, 
      reason: 'Nghi vấn File GPX giả lập (Tệp nguồn .gpx không có cảm biến nhịp tim & guồng chân)' 
    };
  }

  return { isLegit: true };
}
