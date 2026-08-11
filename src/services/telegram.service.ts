import axios from 'axios';
import { env } from '../config/env';
import { getTeamName } from './team.service';

/**
 * Format seconds per km into MM:SS min/km string
 */
export function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0 || !isFinite(secPerKm)) return 'N/A';
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec} min/km`;
}

/**
 * Send HTML formatted message to Telegram Chat ID
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId || chatId === 'your_telegram_bot_token_here') {
    console.warn('[Telegram] Bot token or chat ID missing. Message skipped.');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
    return true;
  } catch (error: any) {
    console.error('[Telegram] Failed to send message:', error?.response?.data || error.message);
    return false;
  }
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
  const timeStr = data.reachedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = data.reachedAt.toLocaleDateString('vi-VN');
  const genderIcon = data.gender === 'FEMALE' ? '👩' : '👨';

  const message = 
`🎉🏆 <b>CHÚC MỪNG HOÀN THÀNH MỐC CHỈ TIÊU (${data.targetKm} KM)!</b> 🏆🎉

🌟 Vận động viên ${genderIcon} <b>${data.nickName}</b>${data.fullName ? ` (${data.fullName})` : ''} đã xuất sắc hoàn thành mốc <b>${data.targetKm}.0 KM TÍCH LŨY</b>!

⏱ <b>Thời điểm cán đích:</b> ${timeStr} - ${dateStr}

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

  const message = 
`🚨 <b>CẢNH BÁO BÀI CHẠY PHẠM QUY (ANTI-CHEAT)</b> 🚨

👤 <b>Vận động viên:</b> <b>${data.nickName}</b>${data.fullName ? ` (${data.fullName})` : ''}
📌 <b>Bài chạy:</b> <a href="${stravaUrl}">${data.activityName}</a> (ID: <code>${actIdStr}</code>)
❌ <b>Lý do vi phạm:</b> <code>${data.reason}</code>

⚠️ <i>Bài chạy này tạm thời bị loại (isLegit = false). Ban Tổ Chức bấm nút bên dưới để duyệt hoặc giữ nguyên:</i>`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Duyệt Hợp Lệ (Mark Legit)', callback_data: `approve_${actIdStr}` },
        { text: '❌ Giữ Nguyên Loại (Keep Invalid)', callback_data: `reject_${actIdStr}` }
      ]
    ]
  };

  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: env.TELEGRAM_GROUP_ID,
      text: message,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });
    return true;
  } catch (error: any) {
    console.error('[Telegram] Failed to send cheating alert with buttons:', error?.response?.data || error.message);
    return false;
  }
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
  const message = 
`🗑️ <b>[THÔNG BÁO XÓA BÀI CHẠY TỪ STRAVA]</b> 🗑️

👤 <b>VĐV:</b> <b>${data.nickName}</b>${data.fullName ? ` (${data.fullName})` : ''}
📌 <b>Bài chạy:</b> <a href="${stravaUrl}">${data.activityName}</a> (ID: <code>${data.stravaActivityId}</code>)
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
  const message = 
`✏️ <b>[THÔNG BÁO SỬA BÀI CHẠY TỪ STRAVA]</b> ✏️

👤 <b>VĐV:</b> <b>${data.nickName}</b>${data.fullName ? ` (${data.fullName})` : ''}
📌 <b>Bài chạy:</b> <a href="${stravaUrl}">${data.activityName}</a> (ID: <code>${data.stravaActivityId}</code>)
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
  const message = 
`🧹 <b>[ĐỒNG BỘ: DỌN DẸP BÀI CHẠY ĐÃ XÓA TỪ STRAVA]</b> 🧹

👤 <b>VĐV:</b> <b>${data.nickName}</b>${data.fullName ? ` (${data.fullName})` : ''}
🗑️ <b>Số bài đã xóa trên Strava:</b> <code>${data.deletedCount} bài</code>
🏃 <b>Tổng số km đã trừ:</b> <code>${data.deletedKm.toFixed(2)} km</code>
📊 <b>Tổng km tích lũy mới:</b> <code>${data.newTotalKm.toFixed(2)} km</code>`;

  await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message);
}
