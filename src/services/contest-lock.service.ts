import { db } from '../config/db';
import { env } from '../config/env';
import { sendTelegramMessage } from './telegram.service';
import { escapeHtml } from '../utils/format';

/**
 * Official Contest Window Boundaries
 * Start: 00:00:00 03/08/2026 (or 2026-07-01 if ALLOW_TEST_DATE is true)
 * End: 23:59:59 30/08/2026 (Cutoff boundary: 00:00:00 31/08/2026 Asia/Ho_Chi_Minh)
 */
export const CONTEST_START_DATE = new Date('2026-08-03T00:00:00+07:00');
export const CONTEST_LOCK_DEADLINE = new Date('2026-08-31T00:00:00+07:00');

/**
 * Check if the contest is currently in a locked/frozen state.
 * Returns true if current time is on or after 00:00:00 31/08/2026 (or if FORCE_CONTEST_LOCK is true).
 * When ALLOW_TEST_DATE is true in development/testing, returns false unless FORCE_CONTEST_LOCK is set.
 */
export function isContestLocked(): boolean {
  if (process.env.FORCE_CONTEST_LOCK === 'true') {
    return true;
  }
  if (env.ALLOW_TEST_DATE && process.env.FORCE_CONTEST_LOCK !== 'true') {
    return false;
  }
  return Date.now() >= CONTEST_LOCK_DEADLINE.getTime();
}

/**
 * Check if an activity completed strictly within the contest time window.
 * An activity must start on/after contest start AND complete (start + elapsed) before 00:00:00 31/08/2026.
 */
export function isActivityCompletedInContestWindow(startDate: Date, elapsedSec: number = 0): boolean {
  if (isNaN(startDate.getTime())) return false;
  
  const contestStart = env.ALLOW_TEST_DATE ? new Date('2026-07-01T00:00:00+07:00') : CONTEST_START_DATE;
  const endDate = new Date(startDate.getTime() + Math.max(0, elapsedSec) * 1000);

  return startDate >= contestStart && endDate < CONTEST_LOCK_DEADLINE;
}

export interface TamperingAlertParams {
  athleteId: string | bigint | number;
  stravaActivityId?: string | bigint | number;
  aspectType: 'create' | 'update' | 'delete';
  user?: any;
  activityName?: string;
  distanceKm?: number;
}

/**
 * Notify the BTC Admin Telegram Group whenever an athlete attempts to modify, delete,
 * or submit activities after the contest freeze deadline.
 */
export async function notifyContestTamperingAlert(params: TamperingAlertParams): Promise<void> {
  try {
    const { athleteId, stravaActivityId, aspectType, user: providedUser, activityName, distanceKm } = params;

    // Look up user if not provided
    let user = providedUser;
    if (!user && athleteId) {
      try {
        user = await db.user.findUnique({
          where: { stravaAthleteId: BigInt(athleteId) }
        });
      } catch (err) {
        console.error('[Contest Lock Alert] Error fetching user for alert:', err);
      }
    }

    const userName = user?.fullName || user?.nickName || 'VĐV không xác định';
    const nickName = user?.nickName ? `@${user.nickName}` : `(ID: ${athleteId})`;
    const actIdStr = stravaActivityId ? String(stravaActivityId) : 'N/A';
    const nowStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    let title = '';
    let description = '';
    let actionBadge = '';

    if (aspectType === 'delete') {
      title = `🚨 <b>[CẢNH BÁO KHÓA SỔ - ĐÃ CHẶN XÓA BÀI]</b> 🚨`;
      actionBadge = `🗑️ <b>Hành động:</b> Cố tình <u>XÓA</u> bài chạy trên Strava sau giờ chốt`;
      description = `🛡️ <b>Hệ thống xử lý:</b> Đã <b>CHẶN XÓA</b> trong Cơ sở dữ liệu, bảo toàn 100% số km của VĐV.`;
    } else if (aspectType === 'update') {
      title = `⚠️ <b>[CẢNH BÁO KHÓA SỔ - ĐÃ CHẶN SỬA/CẮT BÀI]</b> ⚠️`;
      actionBadge = `✏️ <b>Hành động:</b> Cố tình <u>CHỈNH SỬA / CẮT (Crop)</u> bài chạy sau giờ chốt`;
      description = `🛡️ <b>Hệ thống xử lý:</b> Đã <b>CHẶN GHI ĐÈ</b>, giữ nguyên khoảng cách và Pace gốc ban đầu.`;
    } else {
      title = `ℹ️ <b>[KHÓA SỔ - BÀI CHẠY NGOÀI KHUNG GIỜ]</b> ℹ️`;
      actionBadge = `🏃 <b>Hành động:</b> Nộp bài chạy mới sau khi giải đã đóng`;
      description = `🛡️ <b>Hệ thống xử lý:</b> Không tiếp nhận vào bảng xếp hạng giải đấu.`;
    }

    let actDetail = `• <b>Activity ID:</b> <code>${actIdStr}</code>`;
    if (activityName) actDetail += `\n• <b>Tên bài chạy:</b> <i>${escapeHtml(activityName)}</i>`;
    if (distanceKm !== undefined && distanceKm > 0) actDetail += `\n• <b>Cự ly:</b> <code>${distanceKm.toFixed(2)} km</code>`;

    const message = 
`${title}
⏱ <i>Thời điểm phát hiện: ${nowStr}</i>
━━━━━━━━━━━━━━━━━━━━
👤 <b>VĐV:</b> <b>${escapeHtml(userName)}</b> (${escapeHtml(nickName)})
${actionBadge}
${actDetail}

${description}
━━━━━━━━━━━━━━━━━━━━
<i>Dữ liệu giải đấu đã được đóng băng an toàn tuyệt đối.</i>`;

    const targetGroupId = env.TELEGRAM_GROUP_ID;
    if (targetGroupId) {
      await sendTelegramMessage(targetGroupId, message);
    }
  } catch (error: any) {
    console.error('[Contest Lock Alert] Failed to send Telegram alert:', error?.message || error);
  }
}
