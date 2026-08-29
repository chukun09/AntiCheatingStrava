import { env } from '../config/env';

export interface ValidationResult {
  isLegit: boolean;
  reason?: string;
}

// Contest Start & End dates: 00:00 03/08/2026 -> 23:59:59 30/08/2026 (boundary 00:00:00 31/08/2026)
const CONTEST_START = new Date('2026-08-03T00:00:00+07:00');
const CONTEST_END = new Date('2026-08-31T00:00:00+07:00');

export function validateActivity(activity: any): ValidationResult {
  if (!activity) {
    return { isLegit: false, reason: 'Dữ liệu bài chạy rỗng (Empty payload)' };
  }

  // 0. Check Contest Date Window (Bypassed if ALLOW_TEST_DATE=true in .env for pre-contest testing)
  if (env.ALLOW_TEST_DATE) {
    console.log('[Anti-Cheat] ALLOW_TEST_DATE=true -> Bypassing contest start date window check for test activity.');
  } else {
    const rawDateStr = activity.start_date || activity.start_date_local;
    if (!rawDateStr) {
      return { isLegit: false, reason: 'Thiếu dữ liệu ngày bắt đầu bài chạy' };
    }
    const startDate = new Date(rawDateStr);
    if (isNaN(startDate.getTime()) || startDate < CONTEST_START) {
      return {
        isLegit: false,
        reason: `Bài chạy xuất phát trước thời gian diễn ra cuộc thi (trước 00:00 ngày 03/08/2026)`
      };
    }

    const elapsedSec = Math.max(activity.elapsed_time || 0, activity.moving_time || 0);
    const endDate = new Date(startDate.getTime() + elapsedSec * 1000);
    if (endDate >= CONTEST_END) {
      return {
        isLegit: false,
        reason: `Bài chạy kết thúc sau thời điểm đóng sổ cuộc thi (kết thúc lúc ${endDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}, sau 23:59:59 ngày 30/08/2026)`
      };
    }
  }

  // 1. Check Activity Type (Only Run, TrailRun, or VirtualRun)
  const allowedTypes = ['Run', 'TrailRun', 'VirtualRun'];
  if (!activity.type || !allowedTypes.includes(activity.type)) {
    return {
      isLegit: false,
      reason: `Loại vận động không hợp lệ: ${activity.type || 'Không xác định'} (Chỉ tính Run / TrailRun / VirtualRun)`
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
  if (!activity.distance || typeof activity.distance !== 'number' || activity.distance <= 0) {
    return {
      isLegit: false,
      reason: 'Quãng đường không hợp lệ (<= 0m)'
    };
  }

  // Moving time guard check to prevent NaN in all pace calculations
  if (!activity.moving_time || typeof activity.moving_time !== 'number' || activity.moving_time <= 0 || !isFinite(activity.moving_time)) {
    return {
      isLegit: false,
      reason: 'Thiếu dữ liệu thời gian di chuyển (moving_time invalid/missing)'
    };
  }

  // 4. Block abnormal Max Speed (> 35.0 km/h)
  const maxSpeedKmH = (activity.max_speed || 0) * 3.6;
  if (maxSpeedKmH > 35.0) {
    return {
      isLegit: false,
      reason: `Tốc độ tối đa bất thường: ${maxSpeedKmH.toFixed(1)} km/h (Vượt ngưỡng 35.0 km/h)`
    };
  }

  // 5. Block abnormal Average Pace (< 4:00 min/km ~ 240 seconds/km per IRIS Rules)
  const averagePaceSecPerKm = activity.moving_time / (activity.distance / 1000);
  if (averagePaceSecPerKm < 240) {
    const totalSec = Math.round(averagePaceSecPerKm);
    const paceMin = Math.floor(totalSec / 60);
    const paceSec = totalSec % 60;
    const paceStr = `${paceMin}:${paceSec < 10 ? '0' : ''}${paceSec}`;
    return {
      isLegit: false,
      reason: `Pace trung bình quá nhanh: ${paceStr} min/km (Nhanh hơn ngưỡng 4:00 min/km theo Thể lệ IRIS)`
    };
  }

  // 6. Detect Sudden Pace/Speed Spike Anomaly (Biến động tốc độ / Pace bất thường)
  const avgSpeedKmH = (activity.average_speed || 0) * 3.6;
  if (avgSpeedKmH > 0 && maxSpeedKmH > 28.0) {
    // If Max Speed is more than 4.5x higher than Average Speed (e.g. running 6 km/h but max speed spiked to > 28 km/h)
    const speedRatio = maxSpeedKmH / avgSpeedKmH;
    if (speedRatio > 4.5) {
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
            const totalSec = Math.round(splitPaceSec);
            const minStr = Math.floor(totalSec / 60);
            const secStr = totalSec % 60;
            const spikePaceStr = `${minStr}:${secStr < 10 ? '0' : ''}${secStr}`;
            return {
              isLegit: false,
              reason: `Biến động Pace đột ngột: Km ${i + 1} Pace tăng bất thường lên ${spikePaceStr} min/km so với các km lân cận`
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

  // 9. Detect Dedicated Sports Watch with Missing/Zero Cadence (Garmin, Coros, Suunto, Polar)
  const deviceName = activity.device_name ? String(activity.device_name).toLowerCase() : '';
  const isDedicatedSportsWatch = ['garmin', 'coros', 'suunto', 'polar'].some(brand => deviceName.includes(brand));
  if (isDedicatedSportsWatch && noCadence && averagePaceSecPerKm < 480) { // Pace < 8:00 min/km
    return {
      isLegit: false,
      reason: `Nghi vấn đặt tay tĩnh trên tay lái xe (Đeo đồng hồ thể thao chuyên dụng ${activity.device_name} nhưng guồng chân Cadence bằng 0)`
    };
  }

  // 10. Detect Abnormally Low Cadence / Step Rate & Stride Length Anomaly (when cadence data exists)
  if (activity.average_cadence && activity.average_cadence > 0) {
    // Strava returns average_cadence in RPM (half-steps per minute). Multiply by 2 for total steps/min.
    const stepsPerMin = Math.round(activity.average_cadence * 2);
    const movingMin = activity.moving_time / 60;
    const totalEstSteps = Math.round(stepsPerMin * movingMin);
    const distKm = activity.distance / 1000;
    const stepsPerKm = distKm > 0 ? totalEstSteps / distKm : 0;
    const strideLengthMeters = totalEstSteps > 0 ? activity.distance / totalEstSteps : 0;

    const totalSec = Math.round(averagePaceSecPerKm);
    const paceMin = Math.floor(totalSec / 60);
    const paceSec = totalSec % 60;
    const paceStr = `${paceMin}:${paceSec < 10 ? '0' : ''}${paceSec}`;

    // 10a. Low Cadence Check (< 100 spm while moving < 7:00 min/km)
    if (stepsPerMin < 100 && averagePaceSecPerKm < 420) {
      return {
        isLegit: false,
        reason: `Nghi vấn đi xe máy/xe điện (Pace di chuyển ${paceStr} min/km nhưng guồng chân Cadence quá thấp: ${stepsPerMin} bước/phút)`
      };
    }

    // 10b. Stride Length Anomaly (> 1.60m per step while moving < 7:00 min/km)
    if (strideLengthMeters > 1.60 && averagePaceSecPerKm < 420 && distKm >= 1.0) {
      return {
        isLegit: false,
        reason: `Sải chân bất thường: ${strideLengthMeters.toFixed(2)}m/bước (Chỉ có ${Math.round(stepsPerKm)} bước/km - Vượt ngưỡng thể lực người chạy thật)`
      };
    }

    // 10c. Minimum Steps Per Km (< 700 steps/km while moving < 7:00 min/km)
    if (stepsPerKm < 700 && averagePaceSecPerKm < 420 && distKm >= 1.0) {
      return {
        isLegit: false,
        reason: `Mật độ bước chân quá thưa: ${Math.round(stepsPerKm)} bước/km (Dấu hiệu di chuyển bằng xe đạp/xe điện)`
      };
    }
  }

  // 11. Detect Abnormally Low Heart Rate vs Physical Effort (when heart rate exists)
  const avgHr = activity.average_heartrate || null;
  if (activity.has_heartrate && avgHr && avgHr > 0) {
    const totalSec = Math.round(averagePaceSecPerKm);
    const paceMin = Math.floor(totalSec / 60);
    const paceSec = totalSec % 60;
    const paceStr = `${paceMin}:${paceSec < 10 ? '0' : ''}${paceSec}`;

    // 11a. Resting Heart Rate check (< 100 bpm while moving < 7:00 min/km)
    if (avgHr < 100 && averagePaceSecPerKm < 420) {
      return {
        isLegit: false,
        reason: `Nghi vấn ngồi phương tiện xe (Pace di chuyển ${paceStr} min/km nhưng nhịp tim trôi ở mức nghỉ: ${Math.round(avgHr)} bpm)`
      };
    }

    // 11b. Low Heart Rate during fast effort (< 115 bpm while moving < 5:00 min/km)
    if (avgHr < 115 && averagePaceSecPerKm < 300) {
      return {
        isLegit: false,
        reason: `Nghi vấn mượn xe/phương tiện (Chạy Pace rất nhanh ${paceStr} min/km nhưng nhịp tim trôi thong thả: ${Math.round(avgHr)} bpm)`
      };
    }
  }

  return { isLegit: true };
}
