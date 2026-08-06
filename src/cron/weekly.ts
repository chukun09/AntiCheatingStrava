import cron from 'node-cron';
import { db } from '../config/db';
import { sendTelegramMessage } from '../services/telegram.service';
import { env } from '../config/env';
import { TEAMS } from '../services/team.service';

/**
 * Initialize Weekly Leaderboard CronJob
 * Runs at 23:59 every Sunday
 */
export function initWeeklyCronJob() {
  cron.schedule('59 23 * * 0', async () => {
    console.log('[CronJob IRIS] Running Sunday Weekly Leaderboard calculation...');
    try {
      const now = new Date();
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(now);
      endOfWeek.setHours(23, 59, 59, 999);

      // Aggregate weekly legit activities
      const weeklyStats = await db.activity.groupBy({
        by: ['userId'],
        where: {
          isLegit: true,
          startDate: {
            gte: startOfWeek,
            lte: endOfWeek
          }
        },
        _sum: {
          distance: true
        },
        _count: {
          id: true
        },
        orderBy: {
          _sum: {
            distance: 'desc'
          }
        },
        take: 10
      });

      if (weeklyStats.length === 0) {
        console.log('[CronJob IRIS] No activities recorded this week.');
        return;
      }

      const userIds = weeklyStats.map(s => s.userId);
      const users = await db.user.findMany({
        where: { id: { in: userIds } }
      });
      const userMap = new Map(users.map(u => [u.id, u]));

      let message = 
`🏆📊 <b>BẢNG XẾP HẠNG TOP RUNNER TUẦN (HÀNH TRÌNH IRIS)</b> 📊🏆
<i>(Tổng hợp đến 23:59 Chủ Nhật)</i>\n\n`;

      weeklyStats.forEach((stat, index) => {
        const user = userMap.get(stat.userId);
        if (!user) return;

        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
        const totalKm = ((stat._sum.distance || 0) / 1000).toFixed(2);
        const runsCount = stat._count.id;
        const genderIcon = user.gender === 'FEMALE' ? '👩' : '👨';

        message += `${medal} ${genderIcon} <b>${user.nickName}</b>: <code>${totalKm} km</code> (${runsCount} bài chạy)\n`;
      });

      message += `\n🎉 <i>Chúc mừng các chiến binh IRIS xuất sắc nhất tuần! Đón xem tổng kết các giải tuần trên nhóm nhé!</i> 💪🔥`;

      await sendTelegramMessage(env.TELEGRAM_GROUP_ID, message);
      console.log('[CronJob IRIS] Weekly Leaderboard broadcast successfully!');
    } catch (error) {
      console.error('[CronJob IRIS] Error running weekly leaderboard cron:', error);
    }
  });

  console.log('[CronJob IRIS] Weekly Sunday Leaderboard cron initialized (Runs every Sunday at 23:59).');
}
