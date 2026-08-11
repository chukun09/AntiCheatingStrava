import { telegramHttp } from '../utils/http';
import { env } from '../config/env';
import { escapeHtml } from '../utils/format';

/**
 * Format Date to UTC+7 (Asia/Ho_Chi_Minh) Vietnam String format: "HH:MM DD/MM/YYYY"
 */
export function formatVietnamDateTime(date: Date | string | null): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Format seconds per km into MM:SS min/km string
 */
export function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0 || !isFinite(secPerKm)) return 'N/A';
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec} min/km`;
}

let lastSendTime = 0;
let telegramSendChain: Promise<any> = Promise.resolve();

/**
 * Send HTML formatted message to Telegram Chat ID.
 * Truncates messages exceeding 4000 characters and throttles rate (~1 msg/sec) to ensure Telegram API compliance.
 */
export async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: any): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId || chatId === 'your_telegram_bot_token_here') {
    console.warn('[Telegram] Bot token or chat ID missing. Message skipped.');
    return false;
  }

  // Truncate message text if it exceeds 4000 chars to avoid Telegram API 400 bad request
  let safeText = text;
  if (safeText.length > 4000) {
    safeText = safeText.slice(0, 3950) + '\n\n<i>[Nội dung quá dài, đã tự động cắt bớt...]</i>';
  }

  // Chain messages sequentially with 1000ms pause to comply with Telegram 20 msg/min group rate limits
  return new Promise((resolve) => {
    telegramSendChain = telegramSendChain.then(async () => {
      const now = Date.now();
      const elapsed = now - lastSendTime;
      if (elapsed < 1000) {
        await new Promise(r => setTimeout(r, 1000 - elapsed));
      }
      lastSendTime = Date.now();

      try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const payload: any = {
          chat_id: chatId,
          text: safeText,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        };

        if (replyMarkup) {
          payload.reply_markup = replyMarkup;
        }

        await telegramHttp.post(url, payload);
        resolve(true);
      } catch (error: any) {
        console.error('[Telegram] Failed to send message:', error?.response?.data || error.message);
        resolve(false);
      }
    });
  });
}

/**
 * Send milestone achievement celebration (Nam 30km / Nữ 15km) to Telegram BTC group
 */
export async function notifyReachedMilestone(data: {
  nickName: string;
  fullName?: string | null;
  gender: string;
  targetKm: number;
  reachedAt: Date;
}) {
  const dateTimeStr = formatVietnamDateTime(data.reachedAt);
  const genderIcon = data.gender === 'FEMALE' ? '👩' : '👨';
  const safeNick = escapeHtml(data.nickName);
  const safeFull = data.fullName ? ` (${escapeHtml(data.fullName)})` : '';

  const message = 
`🎉🏆 <b>CHÚC MỪNG HOÀN THÀNH MỐC CHỈ TIÊU (${data.targetKm} KM)!</b> 🏆🎉

🌟 Vận động viên ${genderIcon} <b>${safeNick}</b>${safeFull} đã xuất sắc hoàn thành mốc <b>${data.targetKm}.0 KM TÍCH LŨY</b>!

⏱ <b>Thời điểm cán đích (UTC+7):</b> ${dateTimeStr}

👏 Xin chúc mừng chiến binh IRIS xuất sắc! Tiếp tục bứt phá cho giải thưởng tập thể nhé! 🔥💪`;

  await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message);
}

/**
 * Send anti-cheat warning alert to Telegram BTC Group WITH Interactive Inline Keyboard Buttons
 */
export async function notifyCheatingAlert(data: {
  nickName: string;
  fullName?: string | null;
  activityName: string;
  reason: string;
  stravaActivityId: bigint | string;
}) {
  const stravaUrl = `https://www.strava.com/activities/${data.stravaActivityId}`;
  const actIdStr = String(data.stravaActivityId);

  const safeNick = escapeHtml(data.nickName);
  const safeFull = data.fullName ? ` (${escapeHtml(data.fullName)})` : '';
  const safeActName = escapeHtml(data.activityName);
  const safeReason = escapeHtml(data.reason);

  const message = 
`🚨 <b>CẢNH BÁO BÀI CHẠY PHẠM QUY (ANTI-CHEAT)</b> 🚨

👤 <b>Vận động viên:</b> <b>${safeNick}</b>${safeFull}
📌 <b>Bài chạy:</b> <a href="${stravaUrl}">${safeActName}</a> (ID: <code>${actIdStr}</code>)
❌ <b>Lý do vi phạm:</b> <code>${safeReason}</code>

⚠️ <i>Bài chạy này tạm thời bị loại (isLegit = false). Ban Tổ Chức bấm nút bên dưới để duyệt hoặc giữ nguyên:</i>`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Duyệt Hợp Lệ (Mark Legit)', callback_data: `approve_${actIdStr}` },
        { text: '❌ Giữ Nguyên Loại (Keep Invalid)', callback_data: `reject_${actIdStr}` }
      ]
    ]
  };

  return await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message, replyMarkup);
}

/**
 * Send notification when an activity is deleted on Strava
 */
export async function notifyActivityDeleted(data: {
  nickName: string;
  fullName?: string | null;
  activityName: string;
  stravaActivityId: bigint | string;
  deletedKm: number;
  newTotalKm: number;
}) {
  const stravaUrl = `https://www.strava.com/activities/${data.stravaActivityId}`;
  const safeNick = escapeHtml(data.nickName);
  const safeFull = data.fullName ? ` (${escapeHtml(data.fullName)})` : '';
  const safeActName = escapeHtml(data.activityName);

  const message = 
`🗑️ <b>[THÔNG BÁO XÓA BÀI CHẠY TỪ STRAVA]</b> 🗑️

👤 <b>VĐV:</b> <b>${safeNick}</b>${safeFull}
📌 <b>Bài chạy:</b> <a href="${stravaUrl}">${safeActName}</a> (ID: <code>${data.stravaActivityId}</code>)
🏃 <b>Số km vừa xóa:</b> <code>${data.deletedKm.toFixed(2)} km</code>
📊 <b>Tổng km tích lũy mới:</b> <code>${data.newTotalKm.toFixed(2)} km</code> (Đã tự động trừ bớt)`;

  await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message);
}

/**
 * Send notification when an activity is updated on Strava
 */
export async function notifyActivityUpdated(data: {
  nickName: string;
  fullName?: string | null;
  activityName: string;
  stravaActivityId: bigint | string;
  oldKm: number;
  newKm: number;
  newTotalKm: number;
  isLegit: boolean;
}) {
  const stravaUrl = `https://www.strava.com/activities/${data.stravaActivityId}`;
  const statusStr = data.isLegit ? '✅ Hợp lệ' : '❌ Phạm quy';
  const safeNick = escapeHtml(data.nickName);
  const safeFull = data.fullName ? ` (${escapeHtml(data.fullName)})` : '';
  const safeActName = escapeHtml(data.activityName);

  const message = 
`✏️ <b>[THÔNG BÁO SỬA BÀI CHẠY TỪ STRAVA]</b> ✏️

👤 <b>VĐV:</b> <b>${safeNick}</b>${safeFull}
📌 <b>Bài chạy:</b> <a href="${stravaUrl}">${safeActName}</a> (ID: <code>${data.stravaActivityId}</code>)
📊 <b>Thay đổi khoảng cách:</b> <code>${data.oldKm.toFixed(2)} km ➔ ${data.newKm.toFixed(2)} km</code> (${statusStr})
🏃 <b>Tổng km tích lũy mới:</b> <code>${data.newTotalKm.toFixed(2)} km</code>`;

  await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message);
}

/**
 * Send summary notification when batch activities are deleted during sync
 */
export async function notifyActivityDeletedBatch(data: {
  nickName: string;
  fullName?: string | null;
  deletedCount: number;
  deletedKm: number;
  newTotalKm: number;
}) {
  const safeNick = escapeHtml(data.nickName);
  const safeFull = data.fullName ? ` (${escapeHtml(data.fullName)})` : '';

  const message = 
`🧹 <b>[ĐỒNG BỘ: DỌN DẸP BÀI CHẠY ĐÃ XÓA TỪ STRAVA]</b> 🧹

👤 <b>VĐV:</b> <b>${safeNick}</b>${safeFull}
🗑️ <b>Số bài đã xóa trên Strava:</b> <code>${data.deletedCount} bài</code>
🏃 <b>Tổng số km đã trừ:</b> <code>${data.deletedKm.toFixed(2)} km</code>
📊 <b>Tổng km tích lũy mới:</b> <code>${data.newTotalKm.toFixed(2)} km</code>`;

  await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message);
}
