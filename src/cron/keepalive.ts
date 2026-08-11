import cron from 'node-cron';
import axios from 'axios';
import { env } from '../config/env';

/**
 * Initialize Self-Ping Keep-Alive CronJob
 * Runs every 5 minutes to prevent Render Free Tier from going to sleep
 */
export function initKeepAliveCronJob() {
  // Cron pattern: Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const healthUrl = `${env.APP_BASE_URL}/health`;
      console.log(`[Keep-Alive Cron] Sending self-ping to ${healthUrl}...`);
      
      const response = await axios.get(healthUrl, { timeout: 5000 });
      console.log(`[Keep-Alive Cron] Ping response: status=${response.status}`);
    } catch (error: any) {
      console.warn(`[Keep-Alive Cron] Ping warning: ${error.message}`);
    }
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  console.log('[Keep-Alive Cron] Self-ping cron initialized (Pings /health every 5 minutes).');
}
