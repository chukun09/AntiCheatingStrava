import { Telegraf } from 'telegraf';
import { db } from '../config/db';
import { env } from '../config/env';
import { TEAMS, getTeamName } from '../services/team.service';
import { calculatePenalties } from '../services/penalty.service';
import { formatPace } from '../services/telegram.service';
import { syncAllUsersPastActivities } from '../services/sync.service';
import { overrideActivityStatus } from '../services/override.service';
import { 
  getWeek1TeamAward, 
  getWeek2TeamAward, 
  getWeek3IndividualAward, 
  getWeek3TeamAward, 
  getWeek4TeamAward 
} from '../services/awards.service';
import { exportViolationsToExcelBuffer } from '../services/excel.service';

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
        const match = rawText.match(/^(?:@[\w_]+\s+)?\/?([a-zA-Z0-9_]+)(?:@[\w_]+)?(?:\s+.*)?$/);
        if (match) {
          const cmdName = match[1].toLowerCase();
          const validCommands = [
            'start', 'help', 'bxh_canhan', 'bxh_doi', 'doi', 'bxh_phong', 'bxh_phongban', 'phong',
            'lichsu', 'chitiet', 'speed_tuan1', 'giai_tuan1', 'giai_tuan2', 
            'giai_tuan3', 'giai_tuan4', 'phat', 'sync', 'duyet', 'huy'
          ];
          if (validCommands.includes(cmdName)) {
            // Normalize command prefix while keeping trailing args
            const trailingArgs = rawText.replace(/^(?:@[\w_]+\s+)?\/?([a-zA-Z0-9_]+)(?:@[\w_]+)?/, '');
            ctx.message.text = `/${cmdName}${trailingArgs}`;
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
🛡️ <code>/bxh_doi [1-8]</code> - Xem BXH 8 Đội Thi (Gõ <code>/bxh_doi 1</code> để xem chi tiết VĐV trong Đội 1).
🏢 <code>/bxh_phong [Tên_Phòng]</code> - Xem BXH Phòng Ban (Gõ <code>/bxh_phong Kỹ thuật</code> để xem chi tiết VĐV).
📋 <code>/lichsu [Nickname]</code> - Xem hồ sơ & danh sách bài chạy chi tiết của 1 VĐV.
🥇 <code>/speed_tuan1</code> - Vinh danh Giải Cá Nhân Tuần 1 (Nam 30km, Nữ 15km).
⚡ <code>/giai_tuan1</code> - Xem BXH Giải Tập Thể Tuần 1 (Tỷ lệ % tham gia >= 3km).
🏃 <code>/giai_tuan2</code> - Xem BXH Giải Tập Thể Tuần 2 (Pace Đội - Ưu đãi Nữ -1 min/km).
🚀 <code>/giai_tuan3</code> - Xem BXH Giải Tuần 3 (Bứt phá Cá nhân & Tập thể).
🏁 <code>/giai_tuan4</code> - Xem BXH Giải Tập Thể Về Đích (Avg Km Cả Giải).
💸 <code>/phat</code> - Thống kê dự kiến đóng góp quỹ cho thành viên chưa đạt chỉ tiêu.
🔄 <code>/sync</code> - Kích hoạt đồng bộ bài chạy mới nhất từ Strava cho tất cả VĐV.
✅ <code>/duyet [ID_Bai_Chay]</code> - BTC duyệt bài chạy thủ công.
❌ <code>/huy [ID_Bai_Chay] [Lý do]</code> - BTC từ chối bài chạy phạm quy.
❓ <code>/help</code> - Hướng dẫn sử dụng Bot.

🔗 <b>Trang đăng ký:</b> Truy cập <a href="${env.APP_BASE_URL}">${env.APP_BASE_URL}</a> để liên kết tài khoản Strava!`;

      return ctx.replyWithHTML(text);
    });

    // Command /bxh_phong or /bxh_phongban or /phong [Tên_Phòng] - Department Leaderboard & Detailed Members
    bot.command(['bxh_phong', 'bxh_phongban', 'phong'], async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        const searchDept = parts.length > 1 ? parts.slice(1).join(' ') : null;

        if (searchDept) {
          // View detailed members for a specific department
          const usersInDept = await db.user.findMany({
            where: {
              department: { contains: searchDept, mode: 'insensitive' }
            },
            orderBy: { totalDistance: 'desc' }
          });

          if (usersInDept.length === 0) {
            return ctx.replyWithHTML(`⚠️ Không tìm thấy phòng ban nào chứa tên <b>"${searchDept}"</b>.`);
          }

          const actualDeptName = usersInDept[0].department || searchDept;
          const totalMeters = usersInDept.reduce((sum, u) => sum + u.totalDistance, 0);
          const avgKm = (totalMeters / 1000) / usersInDept.length;

          let message = `🏢 <b>CHI TIẾT PHÒNG BAN: ${actualDeptName.toUpperCase()}</b> 🏢\n\n`;
          message += `📊 <b>Trung bình phòng:</b> <code>${avgKm.toFixed(2)} km/người</code>\n`;
          message += `🏃 <b>Tổng quãng đường:</b> <code>${(totalMeters / 1000).toFixed(1)} km</code> (${usersInDept.length} VĐV)\n\n`;
          message += `👥 <b>DANH SÁCH CHI TIẾT TỪNG VĐV TRONG PHÒNG:</b>\n`;

          usersInDept.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
            const distKm = (user.totalDistance / 1000).toFixed(2);
            const genderIcon = user.gender === 'FEMALE' ? '👩' : '👨';
            const targetMeters = user.gender === 'FEMALE' ? 15000 : 30000;
            const doneTag = user.totalDistance >= targetMeters ? ' ⚡ (Đã đạt)' : '';

            message += `${medal} ${genderIcon} <b>${user.nickName}</b> (${getTeamName(user.teamId)}): <code>${distKm} km</code>${doneTag}\n`;
          });

          return ctx.replyWithHTML(message);
        }

        // View summary list of all departments
        const users = await db.user.findMany();
        const deptMap = new Map<string, { totalMeters: number; memberCount: number }>();

        users.forEach(u => {
          const deptName = u.department?.trim() || 'Chưa phân phòng';
          const stat = deptMap.get(deptName) || { totalMeters: 0, memberCount: 0 };
          stat.totalMeters += u.totalDistance;
          stat.memberCount += 1;
          deptMap.set(deptName, stat);
        });

        const deptList = Array.from(deptMap.entries()).map(([deptName, stat]) => {
          const avgKm = stat.memberCount > 0 ? (stat.totalMeters / 1000) / stat.memberCount : 0;
          const totalKm = stat.totalMeters / 1000;
          return { deptName, totalKm, memberCount: stat.memberCount, avgKm };
        }).sort((a, b) => b.avgKm - a.avgKm);

        let message = `🏢 <b>BẢNG XẾP HẠNG THÀNH TÍCH PHÒNG BAN (AVG KM/NGƯỜI)</b> 🏢\n\n`;

        if (deptList.length === 0) {
          message += `<i>Chưa có dữ liệu phòng ban.</i>`;
        } else {
          deptList.forEach((dept, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>#${index + 1}</b>`;
            message += `${medal} <b>${dept.deptName}</b>\n`;
            message += `   📊 Trung bình: <code>${dept.avgKm.toFixed(2)} km/người</code> (Tổng ${dept.totalKm.toFixed(1)}km - ${dept.memberCount} VĐV)\n`;
          });
        }

        message += `\n💡 <i>Mẹo: Gõ <code>/bxh_phong Kỹ thuật</code> để xem chi tiết từng VĐV trong Phòng!</i>`;
        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /bxh_phong] Error:', error);
        return ctx.reply('Lỗi khi tải Bảng xếp hạng phòng ban.');
      }
    });

    // Command /bxh_doi [1-8] or /doi [1-8] - Team Leaderboard & Detailed Members per Team
    bot.command(['bxh_doi', 'doi'], async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        const teamParam = parts.length > 1 ? parseInt(parts[1], 10) : null;

        if (teamParam && teamParam >= 1 && teamParam <= 8) {
          // View detailed members for a specific Team ID (1 -> 8)
          const teamInfo = TEAMS.find(t => t.id === teamParam);
          const teamName = teamInfo ? teamInfo.name : `Đội ${teamParam}`;

          const usersInTeam = await db.user.findMany({
            where: { teamId: teamParam },
            orderBy: { totalDistance: 'desc' }
          });

          const totalMeters = usersInTeam.reduce((sum, u) => sum + u.totalDistance, 0);
          const avgKm = usersInTeam.length > 0 ? (totalMeters / 1000) / usersInTeam.length : 0;

          let message = `🛡️ <b>CHI TIẾT THÀNH TÍCH ${teamName.toUpperCase()}</b> 🛡️\n\n`;
          message += `📊 <b>Chỉ số trung bình:</b> <code>${avgKm.toFixed(2)} km/người</code>\n`;
          message += `🏃 <b>Tổng quãng đường cả đội:</b> <code>${(totalMeters / 1000).toFixed(1)} km</code> (${usersInTeam.length} VĐV)\n\n`;
          message += `👥 <b>DANH SÁCH CHI TIẾT TỪNG THÀNH VIÊN TRONG ĐỘI:</b>\n`;

          if (usersInTeam.length === 0) {
            message += `<i>Chưa có VĐV nào trong đội này.</i>`;
          } else {
            usersInTeam.forEach((user, index) => {
              const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
              const distKm = (user.totalDistance / 1000).toFixed(2);
              const genderIcon = user.gender === 'FEMALE' ? '👩' : '👨';
              const targetMeters = user.gender === 'FEMALE' ? 15000 : 30000;
              const doneTag = user.totalDistance >= targetMeters ? ' ⚡ (Đã đạt)' : '';

              message += `${medal} ${genderIcon} <b>${user.nickName}</b> (${user.department || 'N/A'}): <code>${distKm} km</code>${doneTag}\n`;
            });
          }

          return ctx.replyWithHTML(message);
        }

        // View summary leaderboard of all 8 teams
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
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>#${index + 1}.</b>`;
          message += `${medal} <b>${team.name}</b>\n`;
          message += `   📊 Trung bình: <code>${team.avgKm.toFixed(2)} km/người</code> (Tổng: ${team.totalKm.toFixed(1)}km - ${team.memberCount} thành viên)\n`;
        });

        message += `\n💡 <i>Mẹo: Gõ <code>/bxh_doi 1</code> đến <code>/bxh_doi 8</code> để xem chi tiết danh sách VĐV từng Đội!</i>`;
        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /bxh_doi] Error:', error);
        return ctx.reply('Lỗi khi tải Bảng xếp hạng đội thi.');
      }
    });

    // Command /lichsu [Nickname] or /chitiet [Nickname] - Detailed athlete profile & activities history
    bot.command(['lichsu', 'chitiet'], async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length < 2) {
          return ctx.replyWithHTML('⚠️ <b>Cú pháp sai!</b> Vui lòng gõ: <code>/lichsu [Nickname]</code>\nVí dụ: <code>/lichsu CapyLong</code>');
        }

        const searchNick = parts[1];
        const user = await db.user.findFirst({
          where: { nickName: { contains: searchNick, mode: 'insensitive' } },
          include: {
            activities: {
              orderBy: { startDate: 'desc' },
              take: 10
            }
          }
        });

        if (!user) {
          return ctx.replyWithHTML(`⚠️ Không tìm thấy vận động viên nào có Nickname chứa <b>"${searchNick}"</b>.`);
        }

        const genderIcon = user.gender === 'FEMALE' ? '👩' : '👨';
        const targetKm = user.gender === 'FEMALE' ? 15 : 30;
        const totalKm = (user.totalDistance / 1000).toFixed(2);
        const teamName = getTeamName(user.teamId);

        let message = `👤 <b>HỒ SƠ VẬN ĐỘNG VIÊN: ${user.nickName}</b> ${genderIcon}\n`;
        message += `🛡️ <b>Đội thi đấu:</b> ${teamName}\n`;
        message += `🏢 <b>Phòng ban:</b> ${user.department || 'N/A'}\n`;
        message += `📊 <b>Tổng km tích lũy:</b> <code>${totalKm} / ${targetKm} km</code>\n`;
        message += `⚡ <b>Trạng thái mốc:</b> ${user.reachedTargetAt ? `✅ Đã đạt mốc (${new Date(user.reachedTargetAt).toLocaleDateString('vi-VN')})` : '⏳ Chưa đạt chỉ tiêu'}\n\n`;

        message += `🏃 <b>DANH SÁCH BÀI CHẠY GẦN ĐÂY (${user.activities.length} bài):</b>\n`;
        if (user.activities.length === 0) {
          message += `<i>Chưa có bài chạy nào được ghi nhận.</i>\n`;
        } else {
          user.activities.forEach((act, idx) => {
            const distKm = (act.distance / 1000).toFixed(2);
            const dateStr = new Date(act.startDate).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const paceStr = formatPace(act.averagePace);
            const statusIcon = act.isLegit ? '✅' : '❌ (Phạm quy)';
            const stravaUrl = `https://www.strava.com/activities/${act.stravaActivityId}`;

            message += `<b>${idx + 1}.</b> <a href="${stravaUrl}">${act.name}</a> - ${statusIcon}\n`;
            message += `   ⏱️ ${dateStr} | <code>${distKm} km</code> | Pace: <code>${paceStr}</code> (ID: <code>${act.stravaActivityId}</code>)\n`;
            if (!act.isLegit && act.flagReason) {
              message += `   ⚠️ Lý do: <i>${act.flagReason}</i>\n`;
            }
          });
        }

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /lichsu] Error:', error);
        return ctx.reply('Lỗi khi tải lịch sử bài chạy cá nhân.');
      }
    });

    // Interactive Action: Approve activity via Telegram Inline Keyboard Button
    bot.action(/^approve_(\d+)$/, async (ctx) => {
      try {
        const stravaActivityId = ctx.match[1];
        const adminUser = ctx.from?.first_name || ctx.from?.username || 'Ban Tổ Chức';
        
        // Override activity status to legit & recalculate user stats
        const res = await overrideActivityStatus(stravaActivityId, true, `Đã duyệt bởi ${adminUser} qua nút Telegram`);
        
        await ctx.answerCbQuery(`✅ Đã duyệt bài chạy ${stravaActivityId} thành hợp lệ!`);
        
        const updatedText = 
`✅ <b>[ĐÃ DUYỆT HỢP LỆ THỦ CÔNG]</b> ✅

👤 <b>Vận động viên:</b> <b>${res.userName}</b>
📌 <b>Bài chạy ID:</b> <code>${res.stravaActivityId}</code>
📊 <b>Tổng km tích lũy mới:</b> <code>${res.newTotalKm} km</code>
📝 <b>Trạng thái:</b> Đã duyệt Hợp lệ bởi <b>${adminUser}</b>`;

        return ctx.editMessageText(updatedText, { parse_mode: 'HTML' });
      } catch (error: any) {
        console.error('[Bot action approve] Error:', error);
        return ctx.answerCbQuery(`Lỗi: ${error.message}`, { show_alert: true });
      }
    });

    // Interactive Action: Keep invalid activity via Telegram Inline Keyboard Button
    bot.action(/^reject_(\d+)$/, async (ctx) => {
      try {
        const stravaActivityId = ctx.match[1];
        const adminUser = ctx.from?.first_name || ctx.from?.username || 'Ban Tổ Chức';

        await ctx.answerCbQuery(`❌ Đã xác nhận loại bài chạy ${stravaActivityId}`);

        const updatedText = 
`❌ <b>[ĐÃ XÁC NHẬN PHẠM QUY - LOẠI BỎ]</b> ❌

📌 <b>Bài chạy ID:</b> <code>${stravaActivityId}</code>
📝 <b>Xác nhận bởi BTC:</b> <b>${adminUser}</b>
⚠️ <i>Bài chạy giữ nguyên trạng thái bị loại và KHÔNG tính vào thành tích.</i>`;

        return ctx.editMessageText(updatedText, { parse_mode: 'HTML' });
      } catch (error: any) {
        console.error('[Bot action reject] Error:', error);
        return ctx.answerCbQuery(`Lỗi: ${error.message}`, { show_alert: true });
      }
    });

    // Command /duyet [strava_activity_id] - Manually approve activity
    bot.command('duyet', async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length < 2) {
          return ctx.replyWithHTML('⚠️ <b>Cú pháp sai!</b> Vui lòng gõ: <code>/duyet [ID_Bai_Chay_Strava]</code>\nVí dụ: <code>/duyet 19623991159</code>');
        }

        const activityId = parts[1];
        const res = await overrideActivityStatus(activityId, true);

        const text = 
`✅ <b>ĐÃ DUYỆT THÀNH CÔNG BÀI CHẠY!</b> ✅

📌 ID Bài chạy: <code>${res.stravaActivityId}</code>
👤 VĐV: <b>${res.userName}</b>
📊 Tổng tích lũy mới: <code>${res.newTotalKm} km</code>
📝 Trạng thái: <b>Hợp lệ (Legit)</b>`;

        return ctx.replyWithHTML(text);
      } catch (error: any) {
        console.error('[Bot /duyet] Error:', error);
        return ctx.reply(`Lỗi khi duyệt bài chạy: ${error.message}`);
      }
    });

    // Command /huy [strava_activity_id] [lý do] - Manually reject activity
    bot.command('huy', async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length < 2) {
          return ctx.replyWithHTML('⚠️ <b>Cú pháp sai!</b> Vui lòng gõ: <code>/huy [ID_Bai_Chay_Strava] [Lý do]</code>\nVí dụ: <code>/huy 19623991159 Pace quá nhanh</code>');
        }

        const activityId = parts[1];
        const reason = parts.slice(2).join(' ') || 'Ban Tổ Chức từ chối thủ công';
        const res = await overrideActivityStatus(activityId, false, reason);

        const text = 
`❌ <b>ĐÃ TỪ CHỐI BÀI CHẠY!</b> ❌

📌 ID Bài chạy: <code>${res.stravaActivityId}</code>
👤 VĐV: <b>${res.userName}</b>
📊 Tổng tích lũy mới: <code>${res.newTotalKm} km</code>
📝 Lý do: <i>${res.reason}</i>`;

        return ctx.replyWithHTML(text);
      } catch (error: any) {
        console.error('[Bot /huy] Error:', error);
        return ctx.reply(`Lỗi khi từ chối bài chạy: ${error.message}`);
      }
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

    // Command /giai_tuan1 - Week 1 Team Award (% Participation >= 3km + 3-tier tie-breakers)
    bot.command('giai_tuan1', async (ctx) => {
      try {
        const teams = await getWeek1TeamAward();
        let message = `⚡ <b>GIẢI TẬP THỂ TUẦN 1: KHỞI ĐỘNG</b> ⚡\n`;
        message += `<i>(Tiêu chí: Tỷ lệ % VĐV đạt >= 3km | Bằng điểm: Tổng km ➔ TB km/VĐV ➔ VĐV >= 5km)</i>\n\n`;

        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 TOP 1 (1.000.000đ)' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          message += `${medal} <b>${t.teamName}</b>\n`;
          message += `   📊 Tỷ lệ tham gia: <code>${t.participationRate.toFixed(1)}%</code> (${t.qualifiedMembers}/${t.totalMembers} VĐV đạt >= 3km)\n`;
          message += `   🏃 Tổng km Tuần 1: <code>${t.totalDistanceKmWeek1.toFixed(1)} km</code> | TB VĐV: <code>${t.avgKmPerActiveParticipant.toFixed(1)} km/người</code> | (>= 5km: ${t.qualified5KmMembers} VĐV)\n`;
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

    // Command /excel_vipham & /vipham_excel - Flexible Excel Export
    const handleExcelExport = async (ctx: any) => {
      try {
        const text = ctx.message?.text || '';
        const parts = text.split(/\s+/);
        const param = parts.length > 1 ? parts[1] : 'tatca';

        await ctx.reply(`📊 Đang trích xuất báo cáo Excel vi phạm theo bộ lọc "${param}"... Vui lòng đợi trong giây lát.`);

        const result = await exportViolationsToExcelBuffer(param);
        if (result.totalRecords === 0) {
          return ctx.replyWithHTML(`🎉 <b>BÁO CÁO VI PHẠM:</b> Không tìm thấy bài chạy vi phạm nào thuộc bộ lọc "${result.filterTitle}".`);
        }

        await ctx.replyWithDocument(
          { source: result.buffer, filename: result.filename },
          { caption: `📄 <b>BÁO CÁO BÀI CHẠY VI PHẠM</b>\n📌 <b>Bộ lọc:</b> ${result.filterTitle}\n📊 <b>Tổng số bài vi phạm:</b> <code>${result.totalRecords} bài</code>\n💡 <i>Mẹo: Copy cột Activity ID trong file Excel dán vào câu lệnh /duyet [IDs] hoặc /huy [IDs] để xử lý hàng loạt!</i>`, parse_mode: 'HTML' }
        );
      } catch (error: any) {
        console.error('[Bot /excel_vipham] Error:', error);
        return ctx.reply('Lỗi khi xuất tệp Excel bài vi phạm: ' + (error?.message || error));
      }
    };

    bot.command('excel_vipham', handleExcelExport);
    bot.command('vipham_excel', handleExcelExport);

    // Command /duyet <ID1> <ID2> ... - Exact List ID Bulk Approval
    bot.command('duyet', async (ctx) => {
      try {
        const text = ctx.message?.text || '';
        const matches = text.match(/\d{8,}/g);

        if (!matches || matches.length === 0) {
          let msg = `⚠️ <b>HƯỚNG DẪN DUYỆT THEO DANH SÁCH ACTIVITY IDs:</b>\n\n`;
          msg += `Hãy dán danh sách các Activity ID (dạng chuỗi số từ Strava) sau câu lệnh <code>/duyet</code>.\n`;
          msg += `<i>Ví dụ:</i> <code>/duyet 19675590203 19675335814 19674697299</code>\n\n`;
          msg += `💡 <i>Lưu ý: Bạn có thể dán 10, 50, 100 hay 200 IDs cách nhau bởi dấu cách hoặc xuống dòng!</i>`;
          return ctx.replyWithHTML(msg);
        }

        const ids = matches.map((idStr: string) => BigInt(idStr));
        const res = await db.activity.updateMany({
          where: {
            stravaActivityId: { in: ids }
          },
          data: {
            isLegit: true,
            flagReason: 'Đã duyệt hàng loạt theo danh sách IDs bởi BTC'
          }
        });

        return ctx.replyWithHTML(`🟢 <b>DUYỆT THEO DANH SÁCH THÀNH CÔNG!</b>\n\n✅ Đã cập nhật trạng thái Hợp Lệ cho <b>${res.count} / ${ids.length}</b> bài chạy được chỉ định.`);
      } catch (error: any) {
        console.error('[Bot /duyet] Error:', error);
        return ctx.reply('Lỗi khi duyệt hàng loạt theo danh sách: ' + (error?.message || error));
      }
    });

    // Command /huy <ID1> <ID2> ... - Exact List ID Bulk Rejection
    bot.command('huy', async (ctx) => {
      try {
        const text = ctx.message?.text || '';
        const matches = text.match(/\d{8,}/g);

        if (!matches || matches.length === 0) {
          let msg = `⚠️ <b>HƯỚNG DẪN HỦY/LOẠI THEO DANH SÁCH ACTIVITY IDs:</b>\n\n`;
          msg += `Hãy dán danh sách các Activity ID sau câu lệnh <code>/huy</code>.\n`;
          msg += `<i>Ví dụ:</i> <code>/huy 19675590203 19675335814 19674697299</code>`;
          return ctx.replyWithHTML(msg);
        }

        const ids = matches.map((idStr: string) => BigInt(idStr));
        const res = await db.activity.updateMany({
          where: {
            stravaActivityId: { in: ids }
          },
          data: {
            isLegit: false,
            flagReason: 'Xác nhận giữ loại hàng loạt theo danh sách IDs bởi BTC'
          }
        });

        return ctx.replyWithHTML(`🔴 <b>HỦY THEO DANH SÁCH THÀNH CÔNG!</b>\n\n❌ Đã xác nhận loại <b>${res.count} / ${ids.length}</b> bài chạy được chỉ định.`);
      } catch (error: any) {
        console.error('[Bot /huy] Error:', error);
        return ctx.reply('Lỗi khi hủy hàng loạt theo danh sách: ' + (error?.message || error));
      }
    });

    // Command /duyet_tatca - Bulk approve ALL non-legit activities
    bot.command('duyet_tatca', async (ctx) => {
      try {
        const res = await db.activity.updateMany({
          where: { isLegit: false },
          data: {
            isLegit: true,
            flagReason: 'Đã duyệt toàn bộ bởi BTC'
          }
        });

        if (res.count === 0) {
          return ctx.replyWithHTML('🎉 <b>THÔNG BÁO:</b> Hiện tại không có bài chạy vi phạm nào cần duyệt.');
        }

        return ctx.replyWithHTML(`🟢 <b>DUYỆT TOÀN BỘ THÀNH CÔNG!</b>\n\n✅ Đã chuyển trạng thái Hợp Lệ cho tất cả <b>${res.count} bài chạy</b> vi phạm trong CSDL.`);
      } catch (error: any) {
        console.error('[Bot /duyet_tatca] Error:', error);
        return ctx.reply('Lỗi khi duyệt toàn bộ bài vi phạm.');
      }
    });

    // Command /huy_tatca - Bulk confirm reject ALL non-legit activities
    bot.command('huy_tatca', async (ctx) => {
      try {
        const count = await db.activity.count({ where: { isLegit: false } });
        if (count === 0) {
          return ctx.replyWithHTML('🎉 <b>THÔNG BÁO:</b> Hiện tại không có bài chạy vi phạm nào trong danh sách.');
        }

        return ctx.replyWithHTML(`🔴 <b>XÁC NHẬN HỦY TOÀN BỘ!</b>\n\n❌ Đã giữ nguyên trạng thái Loại Bỏ đối với tất cả <b>${count} bài chạy</b> vi phạm.`);
      } catch (error: any) {
        console.error('[Bot /huy_tatca] Error:', error);
        return ctx.reply('Lỗi khi xác nhận hủy toàn bộ.');
      }
    });

    const launchBotWithRetry = (retryCount = 0) => {
      bot?.launch().then(() => {
        console.log('[Telegram Bot] IRIS Challenge Bot launched successfully!');
      }).catch((err) => {
        if (err.message?.includes('409') && retryCount < 5) {
          console.warn(`[Telegram Bot] 409 Conflict (Another bot instance running). Retrying in 5s... (Attempt ${retryCount + 1}/5)`);
          setTimeout(() => launchBotWithRetry(retryCount + 1), 5000);
        } else {
          console.error('[Telegram Bot] Failed to launch bot:', err.message);
        }
      });
    };

    launchBotWithRetry();

    process.once('SIGINT', () => bot?.stop('SIGINT'));
    process.once('SIGTERM', () => bot?.stop('SIGTERM'));

    return bot;
  } catch (error: any) {
    console.error('[Telegram Bot] Error initializing bot:', error.message);
    return null;
  }
}
