import cron from 'node-cron';
import { sendTelegramMessage } from '../services/telegram.service';
import { env } from '../config/env';
import { CONTEST_LOCK_DEADLINE, isContestLocked } from '../services/contest-lock.service';

let hasBroadcastedContestClosure = false;

/**
 * Generate official Contest Closure Announcement message
 */
export function buildContestClosureMessage(): string {
  const dashboardUrl = `${env.APP_BASE_URL}/dashboard`;

  return `🏁🏁 <b>THÔNG BÁO CHÍNH THỨC: ĐÓNG SỔ GIẢI CHẠY IRIS 2026</b> 🏁🏁

⏱ <i>Thời điểm chốt sổ: 00:00:00 Ngày 31/08/2026 (Giờ Việt Nam)</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 <b>CHÚC MỪNG TOÀN THỂ VẬN ĐỘNG VIÊN ĐÃ HOÀN THÀNH CHIẾN DỊCH CHẠY IRIS 2026!</b> 🎉

Sau 4 tuần thi đấu đầy nhiệt huyết, bền bỉ và bùng nổ, chiến dịch chạy <b>HÀNH TRÌNH IRIS 2026</b> đã chính thức khép lại vào lúc <b>23:59:59 ngày 30/08/2026</b>.

🔒 <b>TRẠNG THÁI HỆ THỐNG HIỆN TẠI:</b>
• <b>Cơ sở dữ liệu:</b> Đã <b>ĐÓNG BĂNG HOÀN TOÀN (FROZEN)</b>.
• <b>Cổng đồng bộ & Strava:</b> Tự động từ chối mọi bài chạy mới hoặc hành vi sửa/xóa bài sau giờ chốt.
• <b>Công tác trọng tài:</b> Ban Tổ Chức đang tiến hành rà soát, đối soát các bài chạy vi phạm và tổng kết số liệu chung cuộc.

🏆 <b>KẾT QUẢ VÀ LỄ VINH DANH:</b>
Bảng xếp hạng chung cuộc của <b>08 Đội thi đấu</b> cùng danh sách VĐV đạt các giải thưởng danh giá (Nam/Nữ Xuất sắc, Top 15 Về đích, Phòng ban tiêu biểu) sẽ được Ban Tổ Chức công bố chính thức trong thời gian sớm nhất!

📊 <i>VĐV có thể theo dõi Bảng Xếp Hạng tại:</i> <code>/bxh</code> hoặc qua Web: <a href="${dashboardUrl}">IRIS Dashboard</a>

━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>CẢM ƠN TẤT CẢ CÁC RUNNER ĐÃ CHÁY HẾT MÌNH CÙNG IRIS! 🏃💨🔥</b>`;
}

/**
 * Broadcast official Contest Closure Announcement to Telegram Group
 */
export async function broadcastContestClosureAnnouncement(force: boolean = false): Promise<boolean> {
  if (hasBroadcastedContestClosure && !force) {
    console.log('[Contest Freeze] Closure announcement already broadcasted. Skipping.');
    return false;
  }

  const message = buildContestClosureMessage();
  const targetGroupId = env.TELEGRAM_GROUP_ID;

  if (!targetGroupId) {
    console.warn('[Contest Freeze] TELEGRAM_GROUP_ID is not configured. Cannot broadcast.');
    return false;
  }

  try {
    console.log('[Contest Freeze] Broadcasting official contest closure announcement to Telegram...');
    await sendTelegramMessage(targetGroupId, message);
    hasBroadcastedContestClosure = true;
    console.log('[Contest Freeze] Official contest closure announcement broadcasted successfully!');
    return true;
  } catch (error: any) {
    console.error('[Contest Freeze] Error broadcasting closure announcement:', error?.message || error);
    return false;
  }
}

/**
 * Initialize Contest Freeze CronJob & Heartbeat Watcher
 * Features DUAL-TRIGGER RELIABILITY (100% immune to Render server timezone differences):
 * 1. Node-cron scheduled at exactly 00:00:00 31/08/2026 with timezone: 'Asia/Ho_Chi_Minh'.
 * 2. Epoch-based Heartbeat Watcher running every 30s that checks Date.now() >= CONTEST_LOCK_DEADLINE (1788195600000 ms).
 */
export function initContestFreezeCronJob() {
  // 1. Cron Schedule (Asia/Ho_Chi_Minh: 00:00 31/08)
  cron.schedule('0 0 31 8 *', async () => {
    console.log('[CronJob Contest Freeze] Triggered at 00:00 31/08 Asia/Ho_Chi_Minh!');
    await broadcastContestClosureAnnouncement();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // 2. Epoch-based Heartbeat Guard (Runs every 30s - completely independent of server OS timezone)
  const heartbeatInterval = setInterval(async () => {
    // If current epoch time reached or passed 00:00:00 31/08/2026 Vietnam time (1788195600000 ms)
    if (!env.ALLOW_TEST_DATE && Date.now() >= CONTEST_LOCK_DEADLINE.getTime() && !hasBroadcastedContestClosure) {
      console.log('[Epoch Heartbeat Guard] Detected contest lock deadline reached via Epoch timestamp! Firing broadcast...');
      await broadcastContestClosureAnnouncement();
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  console.log(`[CronJob Contest Freeze] Initialized with Asia/Ho_Chi_Minh timezone & Epoch Heartbeat Watcher (Deadline: ${CONTEST_LOCK_DEADLINE.toISOString()}).`);
}
