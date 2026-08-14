import { Telegraf } from 'telegraf';
import { db } from '../config/db';
import { env } from '../config/env';
import { TEAMS, getTeamName, getTeamWeekDetail } from '../services/team.service';
import { calculatePenalties } from '../services/penalty.service';
import { formatPace, formatVietnamDateTime, sendTelegramMessage } from '../services/telegram.service';
import { syncAllUsersPastActivities } from '../services/sync.service';
import { overrideActivityStatus, recalculateUserStats } from '../services/override.service';
import { 
  getWeek1TeamAward, 
  getWeek2TeamAward, 
  getWeek3IndividualAward, 
  getWeek3TeamAward, 
  getWeek4TeamAward 
} from '../services/awards.service';
import { exportViolationsToExcelBuffer, exportLeaderboardToExcelBuffer } from '../services/excel.service';
import { reconcileAllUsers } from '../services/reconcile.service';
import { getBestPaceActivities } from '../services/activity.service';

let bot: Telegraf | null = null;

function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initTelegramBot(): Telegraf | null {
  if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') {
    console.warn('[Telegram Bot] Token is default or missing. Bot commands will be disabled.');
    return null;
  }

  try {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

    // Middleware to support flexible mention formats:
    // e.g. "@IRIS_Runner_Bot /best-pace", "@IRIS_Runner_Bot best-pace", "/best-pace@IRIS_Runner_Bot"
    bot.use(async (ctx, next) => {
      if (ctx.message && 'text' in ctx.message) {
        const rawText = (ctx.message.text || '').trim();
        // Match patterns like `@Bot /command`, `@Bot command`, `/command@Bot`, `/command`, `command`
        const match = rawText.match(/^(?:@[\w_]+\s+)?\/?([a-zA-Z0-9_-]+)(?:@[\w_]+)?(?:\s+.*)?$/);
        if (match) {
          const cmdName = match[1].toLowerCase();
          const validCommands = [
            'start', 'help', 'bxh_canhan', 'bxh_doi', 'doi', 'bxh_phong', 'bxh_phongban', 'phong',
            'lichsu', 'chitiet', 'speed_tuan1', 'best-pace', 'best_pace', 'giai_tuan1', 'giai_tuan2', 
            'giai_tuan3', 'giai_tuan4', 'phat', 'sync', 'excel_vipham', 'vipham_excel',
            'excel_bxh', 'bxh_excel', 'doisoat', 'duyet', 'huy', 'duyet_tatca', 'huy_tatca'
          ];
          if (validCommands.includes(cmdName)) {
            // Normalize command prefix while keeping trailing args
            const trailingArgs = rawText.replace(/^(?:@[\w_]+\s+)?\/?([a-zA-Z0-9_-]+)(?:@[\w_]+)?/, '');
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
⚡ <code>/best-pace [tuần] [top]</code> - Xem Top bài chạy Pace tốt nhất (VD: <code>/best-pace 1 50</code>).
⚡ <code>/giai_tuan1</code> - Xem BXH Giải Tập Thể Tuần 1 (Tỷ lệ % tham gia >= 3km).
🏃 <code>/giai_tuan2</code> - Xem BXH Giải Tập Thể Tuần 2 (Pace Đội - Ưu đãi Nữ -1 min/km).
🚀 <code>/giai_tuan3</code> - Xem BXH Giải Tuần 3 (Bứt phá Cá nhân & Tập thể).
🏁 <code>/giai_tuan4</code> - Xem BXH Giải Tập Thể Về Đích (Avg Km Cả Giải).
📊 <code>/excel_bxh [tuan1-4/tatca]</code> - Trích xuất file Excel Bảng xếp hạng VĐV theo tuần.
📄 <code>/excel_vipham [tuan1-4/doi1-8/tatca]</code> - Trích xuất file Excel danh sách bài vi phạm.
🔄 <code>/sync</code> - Kích hoạt đồng bộ bài chạy mới nhất từ Strava cho tất cả VĐV.
✅ <code>/duyet [IDs]</code> - BTC duyệt bài chạy hợp lệ theo danh sách IDs.
❌ <code>/huy [IDs]</code> - BTC từ chối bài chạy phạm quy theo danh sách IDs.
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
            return ctx.replyWithHTML(`⚠️ Không tìm thấy phòng ban nào chứa tên <b>"${escapeHtml(searchDept)}"</b>.`);
          }

          const actualDeptName = usersInDept[0].department || searchDept;
          const totalMeters = usersInDept.reduce((sum, u) => sum + u.totalDistance, 0);
          const avgKm = (totalMeters / 1000) / usersInDept.length;

          let message = `🏢 <b>CHI TIẾT PHÒNG BAN: ${escapeHtml(actualDeptName.toUpperCase())}</b> 🏢\n\n`;
          message += `📊 <b>Trung bình phòng:</b> <code>${avgKm.toFixed(2)} km/người</code>\n`;
          message += `🏃 <b>Tổng quãng đường:</b> <code>${(totalMeters / 1000).toFixed(1)} km</code> (${usersInDept.length} VĐV)\n\n`;
          message += `👥 <b>DANH SÁCH CHI TIẾT TỪNG VĐV TRONG PHÒNG:</b>\n`;

          usersInDept.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
            const distKm = (user.totalDistance / 1000).toFixed(2);
            const genderIcon = user.gender === 'FEMALE' ? '👩' : '👨';
            const targetMeters = user.gender === 'FEMALE' ? 15000 : 30000;
            const doneTag = user.totalDistance >= targetMeters ? ' ⚡ (Đã đạt)' : '';

            message += `${medal} ${genderIcon} <b>${escapeHtml(user.nickName)}</b> (${escapeHtml(getTeamName(user.teamId))}): <code>${distKm} km</code>${doneTag}\n`;
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
            message += `${medal} <b>${escapeHtml(dept.deptName)}</b>\n`;
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

    // Command /bxh_doi [1-8] [tuần] or /doi [1-8] [tuần] - Team Leaderboards & Detailed Weekly Breakdown
    bot.command(['bxh_doi', 'doi'], async (ctx) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/);

        if (parts.length > 1) {
          const teamIdArg = parseInt(parts[1], 10);
          if (!isNaN(teamIdArg) && teamIdArg >= 1 && teamIdArg <= 8) {
            let weekNumArg: number | null = null;
            if (parts.length >= 3) {
              const rawWeek = parts.slice(2).join(' ').toLowerCase();
              const match = rawWeek.match(/\d+/);
              if (match) {
                const parsedWeek = parseInt(match[0], 10);
                if (parsedWeek >= 1 && parsedWeek <= 4) {
                  weekNumArg = parsedWeek;
                }
              }
            }

            const detail = await getTeamWeekDetail(teamIdArg, weekNumArg);
            if (!detail) {
              return ctx.replyWithHTML(`❌ Không tìm thấy dữ liệu cho Đội ${teamIdArg}.`);
            }

            const headerWeekStr = detail.weekNumber ? `(TUẦN ${detail.weekNumber})` : `(TÍCH LŨY TOÀN GIẢI)`;
            let message = `🛡️ <b>CHI TIẾT THÀNH TÍCH ${detail.teamName.toUpperCase()} ${headerWeekStr}</b> 🛡️\n`;
            message += `📌 <b>Khung thời gian:</b> ${detail.weekName}\n`;
            message += `📊 <b>VĐV Đạt chỉ tiêu:</b> <code>${detail.qualifiedMembers}/${detail.totalMembers} VĐV</code> (${((detail.qualifiedMembers / detail.totalMembers) * 100).toFixed(1)}%)\n`;
            message += `🏃 <b>Tổng quãng đường Đội:</b> <code>${detail.totalTeamDistanceKm.toFixed(1)} km</code>\n\n`;

            detail.members.forEach((m, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<b>${idx + 1}.</b>`;
              const statusIcon = m.isQualified ? '✅' : '❌';
              const paceStr = m.runCount > 0 ? formatPace(m.avgPaceSecPerKm) : '--:--';
              const genderIcon = m.gender === 'FEMALE' ? '👩' : '👨';

              message += `${medal} ${statusIcon} <b>${escapeHtml(m.nickName)}</b> ${genderIcon}\n`;
              message += `   └─ <code>${m.totalDistanceKm.toFixed(2)} km</code> | ${m.runCount} bài | Pace: <code>${paceStr}</code>\n`;
            });

            return ctx.replyWithHTML(message);
          }
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
          message += `${medal} <b>${escapeHtml(team.name)}</b>\n`;
          message += `   📊 Trung bình: <code>${team.avgKm.toFixed(2)} km/người</code> (Tổng: ${team.totalKm.toFixed(1)}km - ${team.memberCount} thành viên)\n`;
        });

        message += `\n💡 <i>Mẹo: Gõ <code>/doi 2 tuan 1</code> hoặc <code>/doi 2</code> để xem chi tiết danh sách VĐV từng Đội!</i>`;
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

        let message = `👤 <b>HỒ SƠ VẬN ĐỘNG VIÊN: ${escapeHtml(user.nickName)}</b> ${genderIcon}\n`;
        message += `🛡️ <b>Đội thi đấu:</b> ${escapeHtml(teamName)}\n`;
        message += `🏢 <b>Phòng ban:</b> ${escapeHtml(user.department || 'N/A')}\n`;
        message += `📊 <b>Tổng km tích lũy:</b> <code>${totalKm} / ${targetKm} km</code>\n`;
        message += `⚡ <b>Trạng thái mốc:</b> ${user.reachedTargetAt ? `✅ Đã đạt mốc lúc <code>${formatVietnamDateTime(user.reachedTargetAt)}</code> (UTC+7)` : '⏳ Chưa đạt chỉ tiêu'}\n\n`;

        message += `🏃 <b>DANH SÁCH BÀI CHẠY GẦN ĐÂY (${user.activities.length} bài):</b>\n`;
        if (user.activities.length === 0) {
          message += `<i>Chưa có bài chạy nào được ghi nhận.</i>\n`;
        } else {
          user.activities.forEach((act, idx) => {
            const distKm = (act.distance / 1000).toFixed(2);
            const dateStr = formatVietnamDateTime(act.startDate);
            const paceStr = formatPace(act.averagePace);
            const statusIcon = act.isLegit ? '✅' : '❌ (Phạm quy)';
            const stravaUrl = `https://www.strava.com/activities/${act.stravaActivityId}`;

            message += `<b>${idx + 1}.</b> <a href="${stravaUrl}">${escapeHtml(act.name)}</a> - ${statusIcon}\n`;
            message += `   ⏱️ ${dateStr} (UTC+7) | <code>${distKm} km</code> | Pace: <code>${paceStr}</code> (ID: <code>${act.stravaActivityId}</code>)\n`;
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



    // Command /sync - Active Manual Sync for all athletes (Async Non-Blocking)
    bot.command('sync', async (ctx) => {
      try {
        await ctx.replyWithHTML('⏳ <b>ĐÃ KÍCH HOẠT ĐỒNG BỘ NỀN!</b>\n\nTiến trình đồng bộ dữ liệu bài chạy quá khứ cho toàn bộ VĐV đang được thực thi trong nền (background). Hệ thống sẽ gửi tin nhắn báo cáo tổng kết ngay khi hoàn tất.');
        
        // Trigger background sync asynchronously without blocking Telegraf handler
        syncAllUsersPastActivities().then(async (res) => {
          if (res.isAlreadyRunning) {
            await sendTelegramMessage(
              env.TELEGRAM_GROUP_ID,
              '⚠️ <b>THÔNG BÁO:</b> Tiến trình đồng bộ dữ liệu toàn bộ VĐV hiện đang chạy. Vui lòng chờ tiến trình trước hoàn tất!'
            );
            return;
          }

          const text = 
`🔄 <b>ĐỒNG BỘ DỮ LIỆU HOÀN TẤT!</b> 🔄

📊 Đã đối soát: <b>${res.totalUsers}</b> vận động viên.
🏃 Đã nạp & xử lý mới: <b>${res.totalSynced}</b> bài chạy active từ Strava.
🧹 Đã dọn dẹp & trừ km: <b>${res.totalDeleted}</b> bài đã bị xóa trên Strava.

Gõ <code>/bxh_canhan</code> hoặc <code>/bxh_doi</code> để xem Bảng xếp hạng mới nhất!`;

          await sendTelegramMessage(env.TELEGRAM_GROUP_ID, text);
        }).catch((err) => {
          console.error('[Bot /sync Background] Error:', err);
        });

        return;
      } catch (error) {
        console.error('[Bot /sync] Error triggering sync:', error);
        return ctx.reply('Lỗi khi kích hoạt đồng bộ dữ liệu.');
      }
    });

    // Command /bxh_canhan - Individual Leaderboards (Male & Female split)
    bot.command('bxh_canhan', async (ctx) => {
      try {
        const maleUsers = await db.user.findMany({
          where: { gender: 'MALE' },
          orderBy: { totalDistance: 'desc' },
          take: 10
        });

        const femaleUsers = await db.user.findMany({
          where: { gender: 'FEMALE' },
          orderBy: { totalDistance: 'desc' },
          take: 10
        });

        let message = `🏆 <b>BẢNG XẾP HẠNG CÁ NHÂN - HÀNH TRÌNH IRIS</b> 🏆\n\n`;

        message += `👨 <b>TOP 10 NAM (Chỉ tiêu 30km):</b>\n`;
        if (maleUsers.length === 0) {
          message += `<i>Chưa có dữ liệu.</i>\n`;
        } else {
          maleUsers.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
            const distKm = (user.totalDistance / 1000).toFixed(2);
            const doneTag = user.totalDistance >= 30000 ? ' ⚡ (Đã đạt 30km)' : '';
            message += `${medal} <b>${escapeHtml(user.nickName)}</b> (${getTeamName(user.teamId)}): <code>${distKm} km</code>${doneTag}\n`;
          });
        }

        message += `\n👩 <b>TOP 10 NỮ (Chỉ tiêu 15km):</b>\n`;
        if (femaleUsers.length === 0) {
          message += `<i>Chưa có dữ liệu.</i>\n`;
        } else {
          femaleUsers.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>${index + 1}.</b>`;
            const distKm = (user.totalDistance / 1000).toFixed(2);
            const doneTag = user.totalDistance >= 15000 ? ' ⚡ (Đã đạt 15km)' : '';
            message += `${medal} <b>${escapeHtml(user.nickName)}</b> (${getTeamName(user.teamId)}): <code>${distKm} km</code>${doneTag}\n`;
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
            const timeStr = formatVietnamDateTime(user.reachedTargetAt);
            message += `${rank} - <b>${escapeHtml(user.nickName)}</b>: Cán mốc lúc <code>${timeStr}</code> (UTC+7)\n`;
          });
        }

        message += `\n👩 <b>NỮ (HOÀN THÀNH 15KM ĐẦU TIÊN):</b>\n`;
        if (femaleWinners.length === 0) {
          message += `<i>Chưa có vận động viên Nữ nào hoàn thành 15km.</i>\n`;
        } else {
          femaleWinners.forEach((user, index) => {
            const rank = index === 0 ? '👑 GIẢI NHẤT (500k)' : `#${index + 1}`;
            const timeStr = formatVietnamDateTime(user.reachedTargetAt);
            message += `${rank} - <b>${escapeHtml(user.nickName)}</b>: Cán mốc lúc <code>${timeStr}</code> (UTC+7)\n`;
          });
        }

        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /speed_tuan1] Error:', error);
        return ctx.reply('Lỗi khi tải thông tin Giải Tuần 1.');
      }
    });

    // Command /best-pace [tuần] [top_count] or /best_pace [tuần] [top_count]
    const handleBestPace = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/);

        let weekParam: string | number = '';
        let limitParam = 10;

        if (parts.length === 2) {
          // e.g. /best-pace 1 or /best-pace tuan1
          weekParam = parts[1];
        } else if (parts.length >= 3) {
          // e.g. /best-pace 1 50 or /best-pace tuan1 20
          weekParam = parts[1];
          const parsedLimit = parseInt(parts[2], 10);
          if (!isNaN(parsedLimit) && parsedLimit > 0) {
            limitParam = parsedLimit;
          }
        }

        const res = await getBestPaceActivities({
          week: weekParam,
          limit: limitParam
        });

        if (res.activities.length === 0) {
          return ctx.replyWithHTML(`🏃 <b>TOP BÀI CHẠY PACE TỐT NHẤT (${escapeHtml(res.weekTitle.toUpperCase())})</b>\n\n<i>Chưa có bài chạy hợp lệ nào trong khoảng thời gian này.</i>`);
        }

        const header = `⚡ <b>TOP ${res.activities.length} BÀI CHẠY PACE TỐT NHẤT (${escapeHtml(res.weekTitle.toUpperCase())})</b> ⚡\n\n`;

        const itemLines: string[] = [];
        res.activities.forEach((act, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<b>#${idx + 1}.</b>`;
          const distKm = (act.distance / 1000).toFixed(2);
          const paceStr = formatPace(act.averagePace);
          const stravaUrl = `https://www.strava.com/activities/${act.stravaActivityId}`;
          const athleteName = act.user.fullName || act.user.nickName;
          const teamName = getTeamName(act.user.teamId);

          let line = `${medal} <b>${escapeHtml(athleteName)}</b> (@${escapeHtml(act.user.nickName)} - ${escapeHtml(teamName)})\n`;
          line += `   └─ <a href="${stravaUrl}">${escapeHtml(act.name)}</a> | <code>${distKm} km</code> | Pace: <b>${paceStr} min/km</b> (ID: <code>${act.stravaActivityId}</code>)\n`;
          itemLines.push(line);
        });

        // Split message if exceeding Telegram max character limit
        let currentMessage = header;
        const messagesToSend: string[] = [];

        for (const line of itemLines) {
          if ((currentMessage + line).length > 3800) {
            messagesToSend.push(currentMessage);
            currentMessage = line;
          } else {
            currentMessage += line;
          }
        }
        if (currentMessage.length > 0) {
          messagesToSend.push(currentMessage);
        }

        for (const msg of messagesToSend) {
          await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
        }
      } catch (error: any) {
        console.error('[Bot /best-pace] Error:', error);
        return ctx.reply('Lỗi khi lấy danh sách bài chạy Pace tốt nhất: ' + (error?.message || error));
      }
    };

    bot.command('best-pace', handleBestPace);
    bot.command('best_pace', handleBestPace);

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
        message += `👨 <b>Nam:</b> ${ind.males[0] ? `<b>${escapeHtml(ind.males[0].user?.nickName)}</b> (<code>${ind.males[0].totalKm.toFixed(1)} km</code>)` : 'Chưa có dữ liệu'}\n`;
        message += `👩 <b>Nữ:</b> ${ind.females[0] ? `<b>${escapeHtml(ind.females[0].user?.nickName)}</b> (<code>${ind.females[0].totalKm.toFixed(1)} km</code>)` : 'Chưa có dữ liệu'}\n\n`;

        message += `🛡️ <b>TẬP THỂ TĂNG TỐC (AVG KM/NGƯỜI TUẦN 3):</b>\n`;
        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 TOP 1 (1.000.000đ)' : `#${index + 1}`;
          message += `${medal} <b>${escapeHtml(t.teamName)}</b>: <code>${t.avgKmPerMember.toFixed(2)} km/người</code> (Tổng ${t.totalKmWeek3.toFixed(1)}km)\n`;
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
          message += `${medal} <b>${escapeHtml(t.teamName)}</b>\n`;
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

          message += `${genderIcon} <b>${escapeHtml(p.nickName)}</b> (${escapeHtml(getTeamName(p.teamId))}):\n`;
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
        const parts = text.trim().split(/\s+/);
        const param = parts.length > 1 ? parts.slice(1).join(' ') : 'tatca';

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

    // Command /excel_bxh & /bxh_excel - Leaderboard Excel Export (Week or All-time)
    const handleLeaderboardExcelExport = async (ctx: any) => {
      try {
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const param = parts.length > 1 ? parts.slice(1).join(' ') : 'tatca';

        await ctx.reply(`📊 Đang trích xuất Bảng Xếp Hạng Excel theo bộ lọc "${param}"... Vui lòng đợi trong giây lát.`);

        const result = await exportLeaderboardToExcelBuffer(param);

        await ctx.replyWithDocument(
          { source: result.buffer, filename: result.filename },
          { caption: `📄 <b>EXCEL BẢNG XẾP HẠNG VẬN ĐỘNG VIÊN</b>\n📌 <b>Bộ lọc:</b> ${result.filterTitle}\n📊 <b>Tổng số VĐV:</b> <code>${result.totalRecords} người</code>\n💡 <i>Mẹo: Gõ <code>/excel_bxh tuan1</code>, <code>/excel_bxh tuan2</code>, <code>/excel_bxh tuan3</code>, <code>/excel_bxh tuan4</code> hoặc <code>/excel_bxh tatca</code> để lọc theo tuần!</i>`, parse_mode: 'HTML' }
        );
      } catch (error: any) {
        console.error('[Bot /excel_bxh] Error:', error);
        return ctx.reply('Lỗi khi xuất tệp Excel Bảng xếp hạng: ' + (error?.message || error));
      }
    };

    bot.command('excel_bxh', handleLeaderboardExcelExport);
    bot.command('bxh_excel', handleLeaderboardExcelExport);

    // Command /doisoat [fix] - Audit & Reconcile User Total Distance
    bot.command('doisoat', async (ctx) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const isFix = text.toLowerCase().includes('fix');

        await ctx.replyWithHTML(`⏳ <i>Đang chạy đối soát tổng quãng đường tất cả VĐV (${isFix ? 'SỬA THẬT' : 'DRY-RUN KIỂM TRA'})...</i>`);

        const res = await reconcileAllUsers({ dryRun: !isFix });

        if (res.diffs.length === 0) {
          return ctx.replyWithHTML(`✅ <b>HỆ THỐNG HOÀN HẢO!</b>\n\nToàn bộ <b>${res.checkedCount} VĐV</b> đều có tổng số km tích lũy khớp 100% với lịch sử bài chạy hợp lệ.`);
        }

        let msg = `🔍 <b>KẾT QUẢ ĐỐI SOÁT DỮ LIỆU (${isFix ? 'ĐÃ SỬA THÀNH CÔNG' : 'BÁO CÁO DRY-RUN'})</b> 🔍\n\n`;
        msg += `📊 <b>Tổng VĐV kiểm tra:</b> ${res.checkedCount}\n`;
        msg += `⚠️ <b>Số VĐV bị lệch km:</b> <code>${res.diffs.length} người</code>\n`;
        msg += `📉 <b>Tổng km chênh lệch:</b> <code>${res.totalDriftKm} km</code>\n\n`;

        res.diffs.slice(0, 15).forEach((d, idx) => {
          msg += `${idx + 1}. <b>${escapeHtml(d.nickName)}</b>: DB <code>${d.dbTotalKm}km</code> ➔ Đúng: <code>${d.calculatedLegitKm}km</code> (Lệch <code>${d.driftKm}km</code>)\n`;
        });

        if (res.diffs.length > 15) {
          msg += `\n... và ${res.diffs.length - 15} VĐV khác.\n`;
        }

        if (!isFix) {
          msg += `\n💡 <i>Để cập nhật chính xác các số liệu bị lệch vào CSDL, hãy gõ lệnh:</i>\n<code>/doisoat fix</code>`;
        } else {
          msg += `\n✅ <i>Đã cập nhật lại tổng số km và mốc thời gian hoàn thành chính xác cho toàn bộ VĐV bị lệch!</i>`;
        }

        return ctx.replyWithHTML(msg);
      } catch (error: any) {
        console.error('[Bot /doisoat] Error:', error);
        return ctx.reply('Lỗi khi chạy đối soát dữ liệu: ' + (error?.message || error));
      }
    });

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
        
        // Find affected user IDs before updating
        const affectedActivities = await db.activity.findMany({
          where: { stravaActivityId: { in: ids } },
          select: { userId: true }
        });
        const affectedUserIds = Array.from(new Set(affectedActivities.map(a => a.userId)));

        const res = await db.activity.updateMany({
          where: { stravaActivityId: { in: ids } },
          data: {
            isLegit: true,
            flagReason: '[BTC] Đã duyệt hàng loạt theo danh sách IDs bởi BTC'
          }
        });

        // Recalculate stats for all affected users
        for (const uId of affectedUserIds) {
          await recalculateUserStats(uId);
        }

        return ctx.replyWithHTML(`🟢 <b>DUYỆT THEO DANH SÁCH THÀNH CÔNG!</b>\n\n✅ Đã cập nhật trạng thái Hợp Lệ và tính lại thành tích cho <b>${res.count} / ${ids.length}</b> bài chạy được chỉ định.`);
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

        // Find affected user IDs before updating
        const affectedActivities = await db.activity.findMany({
          where: { stravaActivityId: { in: ids } },
          select: { userId: true }
        });
        const affectedUserIds = Array.from(new Set(affectedActivities.map(a => a.userId)));

        const res = await db.activity.updateMany({
          where: { stravaActivityId: { in: ids } },
          data: {
            isLegit: false,
            flagReason: '[BTC] Xác nhận giữ loại hàng loạt theo danh sách IDs bởi BTC'
          }
        });

        // Recalculate stats for all affected users
        for (const uId of affectedUserIds) {
          await recalculateUserStats(uId);
        }

        return ctx.replyWithHTML(`🔴 <b>HỦY THEO DANH SÁCH THÀNH CÔNG!</b>\n\n❌ Đã xác nhận loại và tính lại thành tích cho <b>${res.count} / ${ids.length}</b> bài chạy được chỉ định.`);
      } catch (error: any) {
        console.error('[Bot /huy] Error:', error);
        return ctx.reply('Lỗi khi hủy hàng loạt theo danh sách: ' + (error?.message || error));
      }
    });

    // Command /duyet_tatca - Bulk approve ALL non-legit activities
    bot.command('duyet_tatca', async (ctx) => {
      try {
        const nonLegitActivities = await db.activity.findMany({
          where: { isLegit: false },
          select: { userId: true },
          distinct: ['userId']
        });
        const affectedUserIds = nonLegitActivities.map(a => a.userId);

        const res = await db.activity.updateMany({
          where: { isLegit: false },
          data: {
            isLegit: true,
            flagReason: '[BTC] Đã duyệt toàn bộ bởi BTC'
          }
        });

        if (res.count === 0) {
          return ctx.replyWithHTML('🎉 <b>THÔNG BÁO:</b> Hiện tại không có bài chạy vi phạm nào cần duyệt.');
        }

        // Recalculate stats for all affected users
        for (const uId of affectedUserIds) {
          await recalculateUserStats(uId);
        }

        return ctx.replyWithHTML(`🟢 <b>DUYỆT TOÀN BỘ THÀNH CÔNG!</b>\n\n✅ Đã chuyển trạng thái Hợp Lệ và tính lại thành tích cho tất cả <b>${res.count} bài chạy</b> vi phạm trong CSDL.`);
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

        return ctx.replyWithHTML(`📊 <b>THỐNG KÊ BÀI CHẠY VI PHẠM:</b>\n\nHệ thống đang lưu trữ <b>${count} bài chạy</b> vi phạm giữ nguyên trạng thái bị loại Bỏ.`);
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
