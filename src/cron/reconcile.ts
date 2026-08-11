import cron from 'node-cron';
import { reconcileAllUsers } from '../services/reconcile.service';
import { sendTelegramMessage } from '../services/telegram.service';
import { env } from '../config/env';

/**
 * Initialize Daily Reconcile Audit CronJob
 * Runs at 03:00 AM every day (Asia/Ho_Chi_Minh)
 * Performs a dry-run check for distance drift and sends alert to Telegram if drift is detected.
 */
export function initReconcileCronJob() {
  cron.schedule('0 3 * * *', async () => {
    console.log('[CronJob Reconcile] Starting daily 03:00 AM dry-run distance audit...');
    try {
      const result = await reconcileAllUsers({ dryRun: true });
      console.log(`[CronJob Reconcile] Audit finished. Checked ${result.checkedCount} users, drift found in ${result.diffs.length} users.`);

      if (result.diffs.length > 0) {
        let msg = `⚠️ <b>CẢNH BÁO ĐỐI SOÁT DỮ LIỆU (AUDIT CRON 03:00)</b> ⚠️\n\n`;
        msg += `Phát hiện <b>${result.diffs.length} VĐV</b> bị lệch tổng km tích lũy so với lịch sử bài chạy hợp lệ:\n\n`;

        result.diffs.slice(0, 10).forEach(d => {
          msg += `• <b>${d.nickName}</b>: DB <code>${d.dbTotalKm}km</code> ➔ Tính lại <code>${d.calculatedLegitKm}km</code> (Lệch <code>${d.driftKm}km</code>)\n`;
        });

        if (result.diffs.length > 10) {
          msg += `\n... và ${result.diffs.length - 10} VĐV khác.\n`;
        }

        msg += `\n💡 <i>Gõ câu lệnh <code>/doisoat fix</code> trong nhóm BTC để sửa lại các số liệu bị lệch!</i>`;

        await sendTelegramMessage(env.TELEGRAM_GROUP_ID, msg);
      }
    } catch (error: any) {
      console.error('[CronJob Reconcile] Error running daily audit cron:', error?.message || error);
    }
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  console.log('[CronJob Reconcile] Daily 03:00 AM audit cron initialized.');
}
