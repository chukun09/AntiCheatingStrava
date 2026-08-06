import { Telegraf } from 'telegraf';
import { db } from '../config/db';
import { env } from '../config/env';
import { TEAMS, getTeamName } from '../services/team.service';
import { calculatePenalties } from '../services/penalty.service';
import { formatPace } from '../services/telegram.service';
import { syncAllUsersPastActivities } from '../services/sync.service';
import { 
  getWeek1TeamAward, 
  getWeek2TeamAward, 
  getWeek3IndividualAward, 
  getWeek3TeamAward, 
  getWeek4TeamAward 
} from '../services/awards.service';

let bot: Telegraf | null = null;

export function initTelegramBot(): Telegraf | null {
  if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') {
    console.warn('[Telegram Bot] Token is default or missing. Bot commands will be disabled.');
    return null;
  }

  try {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

    // Middleware to support flexible mention formats:
    // e.g. "@IRIS_Runner_Bot /bxh_canhan", "@IRIS_Runner_Bot bxh_canhan", "/bxh_canhan@IRIS_Runner_Bot"
    bot.use(async (ctx, next) => {
      if (ctx.message && 'text' in ctx.message) {
        const rawText = (ctx.message.text || '').trim();
        // Match patterns like `@Bot /command`, `@Bot command`, `/command@Bot`, `/command`, `command`
        const match = rawText.match(/^(?:@[\w_]+\s+)?\/?([a-zA-Z0-9_]+)(?:@[\w_]+)?$/);
        if (match) {
          const cmdName = match[1].toLowerCase();
          const validCommands = [
            'start', 'help', 'bxh_canhan', 'bxh_doi', 'speed_tuan1', 
            'giai_tuan1', 'giai_tuan2', 'giai_tuan3', 'giai_tuan4', 'phat', 'sync'
          ];
          if (validCommands.includes(cmdName)) {
            // Normalize to standard `/command` for Telegraf routing
            ctx.message.text = `/${cmdName}`;
          }
        }
      }
      return next();
    });

    // Command /start or /help
    bot.command(['start', 'help'], (ctx) => {
      const text = 
`🏃‍♂️ <b>HÀNH TRÌNH IRIS: VẠN DẶM VƯƠN XA</b> 🏃‍♂️

Chào mừng các chiến binh đến với Giải Chạy Kỷ Niệm 15 Năm Thành Lập IRIS!

Danh sách lệnh hỗ trợ:
🏆 <code>/bxh_canhan</code> - Xem Bảng Xếp Hạng Cá Nhân (Tách riêng Nam & Nữ).
🛡️ <code>/bxh_doi</code> - Xem Bảng Xếp Hạng 8 Đội Thi Đấu (Tổng Cả Giải).
🥇 <code>/speed_tuan1</code> - Vinh danh Giải Cá Nhân Tuần 1 (Nam 30km, Nữ 15km).
⚡ <code>/giai_tuan1</code> - Xem BXH Giải Tập Thể Tuần 1 (Tỷ lệ % tham gia >= 3km).
🏃 <code>/giai_tuan2</code> - Xem BXH Giải Tập Thể Tuần 2 (Pace Đội - Ưu đãi Nữ -1 min/km).
🚀 <code>/giai_tuan3</code> - Xem BXH Giải Tuần 3 (Bứt phá Cá nhân & Tập thể).
🏁 <code>/giai_tuan4</code> - Xem BXH Giải Tập Thể Về Đích (Avg Km Cả Giải).
💸 <code>/phat</code> - Thống kê dự kiến đóng góp quỹ cho thành viên chưa đạt chỉ tiêu.
🔄 <code>/sync</code> - Kích hoạt đồng bộ bài chạy mới nhất từ Strava cho tất cả VĐV.
❓ <code>/help</code> - Hướng dẫn sử dụng Bot.

🔗 <b>Trang đăng ký:</b> Truy cập <a href="${env.APP_BASE_URL}">${env.APP_BASE_URL}</a> để liên kết tài khoản Strava!`;

      return ctx.replyWithHTML(text);
    });

    // Command /sync - Active Manual Sync for all athletes
    bot.command('sync', async (ctx) => {
      try {
        await ctx.replyWithHTML('⏳ <i>Đang kích hoạt đồng bộ dữ liệu bài chạy từ Strava... Vui lòng chờ trong giây lát!</i>');
        const res = await syncAllUsersPastActivities();
        const text = 
`🔄 <b>ĐỒNG BỘ DỮ LIỆU THÀNH CÔNG!</b> 🔄

📊 Đã kiểm tra <b>${res.totalUsers}</b> vận động viên.
🏃 Đã nạp & xử lý <b>${res.totalSynced}</b> bài chạy mới nhất từ Strava.

Gõ <code>/bxh_canhan</code> hoặc <code>/bxh_doi</code> để xem Bảng xếp hạng mới nhất!`;

        return ctx.replyWithHTML(text);
      } catch (error) {
        console.error('[Bot /sync] Error syncing data:', error);
        return ctx.reply('Lỗi khi thực hiện đồng bộ dữ liệu.');
      }
    });

    // Command /bxh_canhan - Individual Leaderboards (Male & Female split)
    bot.command('bxh_canhan', async (ctx) => {
      try {
        const maleUsers = await db.user.findMany({
          where: { gender: 'MALE' },
          orderBy: { totalDistance: 'desc' },
          take: 5
        });

        const femaleUsers = await db.user.findMany({
          where: { gender: 'FEMALE' },
          orderBy: { totalDistance: 'desc' },
          take: 5
        });

        let message = `🏆 <b>BẢNG XẾP HẠNG CÁ NHÂN - HÀNH TRÌNH IRIS</b> 🏆\n\n`;

        message += `👨 <b>BẢNG NAM (Chỉ tiêu 30km):</b>\n`;
        if (maleUsers.length === 0) {
          message += `<i>Chưa có dữ liệu.</i>\n`;
        } else {
          maleUsers.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
            const distKm = (user.totalDistance / 1000).toFixed(2);
            const doneTag = user.totalDistance >= 30000 ? ' ⚡ (Đã đạt 30km)' : '';
            message += `${medal} <b>${user.nickName}</b> (${getTeamName(user.teamId)}): <code>${distKm} km</code>${doneTag}\n`;
          });
        }

        message += `\n👩 <b>BẢNG NỮ (Chỉ tiêu 15km):</b>\n`;
        if (femaleUsers.length === 0) {
          message += `<i>Chưa có dữ liệu.</i>\n`;
        } else {
          femaleUsers.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
            const distKm = (user.totalDistance / 1000).toFixed(2);
            const doneTag = user.totalDistance >= 15000 ? ' ⚡ (Đã đạt 15km)' : '';
            message += `${medal} <b>${user.nickName}</b> (${getTeamName(user.teamId)}): <code>${distKm} km</code>${doneTag}\n`;
          });
        }

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /bxh_canhan] Error:', error);
        return ctx.reply('Lỗi khi tải dữ liệu Bảng xếp hạng cá nhân.');
      }
    });

    // Command /bxh_doi - Team Leaderboard for 8 Teams
    bot.command('bxh_doi', async (ctx) => {
      try {
        const users = await db.user.findMany();
        
        const teamStatsMap = new Map<number, { totalMeters: number; memberCount: number }>();
        TEAMS.forEach(t => teamStatsMap.set(t.id, { totalMeters: 0, memberCount: 0 }));

        users.forEach(u => {
          const stat = teamStatsMap.get(u.teamId);
          if (stat) {
            stat.totalMeters += u.totalDistance;
            stat.memberCount += 1;
          }
        });

        const teamList = TEAMS.map(t => {
          const stat = teamStatsMap.get(t.id) || { totalMeters: 0, memberCount: 0 };
          const avgKm = stat.memberCount > 0 ? (stat.totalMeters / 1000) / stat.memberCount : 0;
          const totalKm = stat.totalMeters / 1000;
          return {
            id: t.id,
            name: t.name,
            totalKm,
            memberCount: stat.memberCount,
            avgKm
          };
        }).sort((a, b) => b.avgKm - a.avgKm);

        let message = `🛡️ <b>BẢNG XẾP HẠNG 08 ĐỘI THI ĐẤU (AVG KM/NGƯỜI CẢ GIẢI)</b> 🛡️\n\n`;

        teamList.forEach((team, index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
          message += `${medal} <b>${team.name}</b>\n`;
          message += `   📊 Trung bình: <code>${team.avgKm.toFixed(2)} km/người</code> (Tổng: ${team.totalKm.toFixed(1)}km - ${team.memberCount} thành viên)\n`;
        });

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /bxh_doi] Error:', error);
        return ctx.reply('Lỗi khi tải Bảng xếp hạng đội thi.');
      }
    });

    // Command /speed_tuan1 - Week 1 Individual Pace Award Winners (Nam 30km, Nữ 15km)
    bot.command('speed_tuan1', async (ctx) => {
      try {
        const maleWinners = await db.user.findMany({
          where: { gender: 'MALE', reachedTargetAt: { not: null } },
          orderBy: { reachedTargetAt: 'asc' }
        });

        const femaleWinners = await db.user.findMany({
          where: { gender: 'FEMALE', reachedTargetAt: { not: null } },
          orderBy: { reachedTargetAt: 'asc' }
        });

        let message = `⚡ <b>GIẢI TUẦN 1: BƯỚC CHẠY THẦN TỐC (CÁ NHÂN)</b> ⚡\n\n`;

        message += `👨 <b>NAM (HOÀN THÀNH 30KM ĐẦU TIÊN):</b>\n`;
        if (maleWinners.length === 0) {
          message += `<i>Chưa có vận động viên Nam nào hoàn thành 30km.</i>\n`;
        } else {
          maleWinners.forEach((user, index) => {
            const rank = index === 0 ? '👑 GIẢI NHẤT (500k)' : `#${index + 1}`;
            const timeStr = user.reachedTargetAt 
              ? new Date(user.reachedTargetAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
              : 'N/A';
            message += `${rank} - <b>${user.nickName}</b>: Cán mốc lúc <code>${timeStr}</code>\n`;
          });
        }

        message += `\n👩 <b>NỮ (HOÀN THÀNH 15KM ĐẦU TIÊN):</b>\n`;
        if (femaleWinners.length === 0) {
          message += `<i>Chưa có vận động viên Nữ nào hoàn thành 15km.</i>\n`;
        } else {
          femaleWinners.forEach((user, index) => {
            const rank = index === 0 ? '👑 GIẢI NHẤT (500k)' : `#${index + 1}`;
            const timeStr = user.reachedTargetAt 
              ? new Date(user.reachedTargetAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
              : 'N/A';
            message += `${rank} - <b>${user.nickName}</b>: Cán mốc lúc <code>${timeStr}</code>\n`;
          });
        }

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /speed_tuan1] Error:', error);
        return ctx.reply('Lỗi khi tải thông tin Giải Tuần 1.');
      }
    });

    // Command /giai_tuan1 - Week 1 Team Award (% Participation >= 3km)
    bot.command('giai_tuan1', async (ctx) => {
      try {
        const teams = await getWeek1TeamAward();
        let message = `⚡ <b>GIẢI TẬP THỂ TUẦN 1: KHỞI ĐỘNG (TỶ LỆ % THAM GIA >= 3KM)</b> ⚡\n\n`;

        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 TOP 1 (1.000.000đ)' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          message += `${medal} <b>${t.teamName}</b>\n`;
          message += `   📊 Tỷ lệ tham gia: <code>${t.participationRate.toFixed(1)}%</code> (${t.qualifiedMembers}/${t.totalMembers} VĐV đạt >= 3km)\n`;
        });

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /giai_tuan1] Error:', error);
        return ctx.reply('Lỗi khi tải dữ liệu Giải Tập Thể Tuần 1.');
      }
    });

    // Command /giai_tuan2 - Week 2 Team Award (Team Pace with Female perk -1 min/km)
    bot.command('giai_tuan2', async (ctx) => {
      try {
        const teams = await getWeek2TeamAward();
        let message = `🏃 <b>GIẢI TẬP THỂ TUẦN 2: VƯỢT CHƯỚNG NGẠI VẬT (PACE ĐỘI)</b> 🏃\n`;
        message += `<i>(ĐK cần: 100% VĐV tham gia | Ưu đãi Nữ: giảm 1 min/km khi tổng kết)</i>\n\n`;

        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 TOP 1 (1.000.000đ)' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          const statusTag = t.is100PercentParticipated ? '✅ (100% Tham gia)' : `❌ (${t.participantCount}/${t.totalMembers} VĐV)`;
          const paceStr = formatPace(t.averagePaceSecPerKm);

          message += `${medal} <b>${t.teamName}</b> ${statusTag}\n`;
          message += `   ⚡ Pace trung bình: <code>${paceStr}</code> (Tổng chạy: ${t.totalDistanceKm.toFixed(1)}km)\n`;
        });

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /giai_tuan2] Error:', error);
        return ctx.reply('Lỗi khi tải dữ liệu Giải Tập Thể Tuần 2.');
      }
    });

    // Command /giai_tuan3 - Week 3 Award (Individual Breakthrough & Team Acceleration)
    bot.command('giai_tuan3', async (ctx) => {
      try {
        const ind = await getWeek3IndividualAward();
        const teams = await getWeek3TeamAward();

        let message = `🚀 <b>GIẢI TUẦN 3: TĂNG TỐC & BỨT PHÁ GIỚI HẠN</b> 🚀\n\n`;

        message += `🏆 <b>CÁ NHÂN BỨT PHÁ (KM TUẦN 3 CAO NHẤT):</b>\n`;
        message += `👨 <b>Nam:</b> ${ind.males[0] ? `<b>${ind.males[0].user?.nickName}</b> (<code>${ind.males[0].totalKm.toFixed(1)} km</code>)` : 'Chưa có dữ liệu'}\n`;
        message += `👩 <b>Nữ:</b> ${ind.females[0] ? `<b>${ind.females[0].user?.nickName}</b> (<code>${ind.females[0].totalKm.toFixed(1)} km</code>)` : 'Chưa có dữ liệu'}\n\n`;

        message += `🛡️ <b>TẬP THỂ TĂNG TỐC (AVG KM/NGƯỜI TUẦN 3):</b>\n`;
        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 TOP 1 (1.000.000đ)' : `#${index + 1}`;
          message += `${medal} <b>${t.teamName}</b>: <code>${t.avgKmPerMember.toFixed(2)} km/người</code> (Tổng ${t.totalKmWeek3.toFixed(1)}km)\n`;
        });

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /giai_tuan3] Error:', error);
        return ctx.reply('Lỗi khi tải dữ liệu Giải Tuần 3.');
      }
    });

    // Command /giai_tuan4 - Week 4 Team Award (Avg Km Whole Contest)
    bot.command('giai_tuan4', async (ctx) => {
      try {
        const teams = await getWeek4TeamAward();
        let message = `🏁 <b>GIẢI TẬP THỂ TUẦN 4: VỀ ĐÍCH (AVG KM/NGƯỜI CẢ GIẢI)</b> 🏁\n\n`;

        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 GIẢI NHẤT TẬP THỂ (1.000.000đ)' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          message += `${medal} <b>${t.teamName}</b>\n`;
          message += `   📊 TB cả giải: <code>${t.avgKmPerMember.toFixed(2)} km/người</code> (Tổng ${t.totalKmWholeContest.toFixed(1)}km)\n`;
        });

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /giai_tuan4] Error:', error);
        return ctx.reply('Lỗi khi tải dữ liệu Giải Tuần 4.');
      }
    });

    // Command /phat - Penalty / Contribution Report
    bot.command('phat', async (ctx) => {
      try {
        const penalties = await calculatePenalties();
        const failingPenalties = penalties.filter(p => p.missingKm > 0);

        if (failingPenalties.length === 0) {
          return ctx.replyWithHTML('🎉 <b>XUYÊN SUỐT DỰ ÁN:</b> Tất cả các thành viên đều đã hoàn thành chỉ tiêu tối thiểu!');
        }

        let message = `💸 <b>THỐNG KÊ NGHĨA VỤ ĐÓNG GÓP QUỸ (CHƯA ĐẠT CHỈ TIÊU)</b> 💸\n`;
        message += `<i>(Quy định: Nam 30km, Nữ 15km | Phạt: 100k/km làm tròn)</i>\n\n`;

        let totalFine = 0;
        failingPenalties.sort((a, b) => b.fineAmountVnd - a.fineAmountVnd).forEach((p) => {
          totalFine += p.fineAmountVnd;
          const fineFormatted = (p.fineAmountVnd).toLocaleString('vi-VN');
          const genderIcon = p.gender === 'FEMALE' ? '👩' : '👨';
          const exemptTag = p.isExempt ? ' [Miễn phạt]' : '';

          message += `${genderIcon} <b>${p.nickName}</b> (${getTeamName(p.teamId)}):\n`;
          message += `   Đạt: ${p.totalKmAchieved.toFixed(1)}/${p.targetKm}km -> Thiếu: <b>${p.missingKm} km</b> -> Đóng góp: <code>${fineFormatted} VNĐ</code>${exemptTag}\n`;
        });

        message += `\n💰 <b>TỔNG QUỸ DỰ KIẾN:</b> <code>${totalFine.toLocaleString('vi-VN')} VNĐ</code>`;
        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /phat] Error:', error);
        return ctx.reply('Lỗi khi tải bảng kê phạt đóng góp.');
      }
    });

    bot.launch().then(() => {
      console.log('[Telegram Bot] IRIS Challenge Bot launched successfully!');
    }).catch((err) => {
      console.error('[Telegram Bot] Failed to launch bot:', err.message);
    });

    process.once('SIGINT', () => bot?.stop('SIGINT'));
    process.once('SIGTERM', () => bot?.stop('SIGTERM'));

    return bot;
  } catch (error: any) {
    console.error('[Telegram Bot] Error initializing bot:', error.message);
    return null;
  }
}
