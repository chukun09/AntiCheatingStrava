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

  // 4. Block abnormal Max Speed (> 30.0 km/h)
  const maxSpeedKmH = (activity.max_speed || 0) * 3.6;
  if (maxSpeedKmH > 30.0) {
    return { 
      isLegit: false, 
      reason: `Tốc độ tối đa bất thường: ${maxSpeedKmH.toFixed(1)} km/h (Vượt ngưỡng 30.0 km/h)` 
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

  // 6. Detect Sudden Pace/Speed Spike Anomaly (Biến động tốc độ / Pace bất thường)
  const avgSpeedKmH = (activity.average_speed || 0) * 3.6;
  if (avgSpeedKmH > 0 && maxSpeedKmH > 22.0) {
    // If Max Speed is more than 3.0x higher than Average Speed (e.g. running 7 km/h but max speed spiked to 24 km/h)
    const speedRatio = maxSpeedKmH / avgSpeedKmH;
    if (speedRatio > 3.0) {
      return {
        isLegit: false,
        reason: `Bất thường tốc độ: Tốc độ max (${maxSpeedKmH.toFixed(1)} km/h) cao gấp ${speedRatio.toFixed(1)} lần tốc độ trung bình (${avgSpeedKmH.toFixed(1)} km/h)`
      };
    }
  }

  // 7. Detect Split Anomaly (Biến động Pace đột ngột ở từng km)
  if (Array.isArray(activity.splits_metric) && activity.splits_metric.length >= 2) {
    const splits = activity.splits_metric;
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      if (split.distance >= 500 && split.moving_time > 0) {
        const splitPaceSec = split.moving_time / (split.distance / 1000);
        
        // If a split pace is abnormally fast (< 3:30 min/km = 210s/km)
        if (splitPaceSec < 210) {
          const prevSplit = i > 0 ? splits[i - 1] : null;
          const nextSplit = i < splits.length - 1 ? splits[i + 1] : null;

          const prevPace = prevSplit && prevSplit.distance >= 500 ? prevSplit.moving_time / (prevSplit.distance / 1000) : 0;
          const nextPace = nextSplit && nextSplit.distance >= 500 ? nextSplit.moving_time / (nextSplit.distance / 1000) : 0;

          // If adjacent splits were much slower (> 2:15 min/km difference = 135s/km gap)
          const prevGap = prevPace > 0 ? prevPace - splitPaceSec : 0;
          const nextGap = nextPace > 0 ? nextPace - splitPaceSec : 0;

          if (prevGap > 135 || nextGap > 135) {
            const minStr = Math.floor(splitPaceSec / 60);
            const secStr = Math.round(splitPaceSec % 60);
            const spikePaceStr = `${minStr}:${secStr < 10 ? '0' : ''}${secStr}`;
            return {
              isLegit: false,
              reason: `Biến động Pace đột ngột: Km ${i + 1} Pace vọt lên ${spikePaceStr} min/km rồi giảm nhanh so với các km lân cận`
            };
          }
        }
      }
    }
  }

  // 8. Detect Fake GPX File Upload (Web simulation / Fake My Run)
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
