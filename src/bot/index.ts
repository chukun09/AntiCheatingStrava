import { Telegraf } from 'telegraf';
import { db } from '../config/db';
import { env } from '../config/env';
import { TEAMS, getTeamName, getTeamWeekDetail, getTeamWeeklyLeaderboard } from '../services/team.service';
import { calculatePenalties } from '../services/penalty.service';
import { formatPace, formatVietnamDateTime, sendTelegramMessage } from '../services/telegram.service';
import { syncAllUsersPastActivities, syncUserPastActivities } from '../services/sync.service';
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
import { getCompanySummaryStats } from '../services/stats.service';
import { grantPickleballBonus, revokePickleballBonus } from '../services/bonus.service';
import { getGrowthLeaderboard } from '../services/progress.service';
import { getDepartmentSummaryLeaderboard, getDepartmentMembersDetail } from '../services/department.service';
import { grantWeeklyExemption, revokeWeeklyExemption, getWeeklyExemptionsList } from '../services/exemption.service';
import { getWeeklyActivityReminderList } from '../services/reminder.service';

let bot: Telegraf | null = null;

function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Helper to send chunked HTML messages (<= 3800 chars) to prevent Telegram 400 Bad Request
 */
async function sendChunkedHtmlMessages(ctx: any, header: string, itemLines: string[], footer?: string) {
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

  if (footer) {
    if ((currentMessage + footer).length > 3800) {
      messagesToSend.push(currentMessage);
      currentMessage = footer;
    } else {
      currentMessage += footer;
    }
  }

  if (currentMessage.trim().length > 0) {
    messagesToSend.push(currentMessage);
  }

  for (const msg of messagesToSend) {
    await ctx.replyWithHTML(msg);
  }
}

export function initTelegramBot(): Telegraf | null {
  if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') {
    console.warn('[Telegram Bot] Token is default or missing. Bot commands will be disabled.');
    return null;
  }

  try {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

    // Global Error Handler to prevent bot crash
    bot.catch((err: any, ctx: any) => {
      console.error(`[Telegram Bot] Error in update ${ctx?.update?.update_id}:`, err);
    });

    // Command /start or /help
    bot.command(['start', 'help'], (ctx) => {
      const text = 
`🏃‍♂️ <b>HÀNH TRÌNH IRIS: VẠN DẶM VƯƠN XA</b> 🏃‍♂️

Chào mừng các chiến binh đến với Giải Chạy Kỷ Niệm 15 Năm Thành Lập IRIS!

Danh sách lệnh hỗ trợ:
🏆 <code>/bxh_canhan</code> - Xem Bảng Xếp Hạng Cá Nhân (Tách riêng Nam & Nữ).
🛡️ <code>/bxh_doi [tuần/đội]</code> - Xem BXH 8 Đội Thi & Tỷ lệ đạt 3km (VD: <code>/bxh_doi 3</code>, <code>/bxh_doi 1 3</code>).
🏢 <code>/bxh_phong [tuần/phòng]</code> - Xem BXH Phòng Ban & Tỷ lệ đạt 3km (VD: <code>/bxh_phong 3</code>, <code>/bxh_phong Kỹ thuật 3</code>).
📢 <code>/nhacnho [tuần] [min_km]</code> - Danh sách VĐV chưa có bài chạy >= x km (VD: <code>/nhacnho 3 3</code> hoặc <code>/nhacnho 3 5</code>).
📋 <code>/lichsu [Nickname]</code> - Xem hồ sơ & danh sách bài chạy chi tiết của 1 VĐV.
📊 <code>/tonghop [tuần/tatca]</code> - Báo cáo tổng hợp tỷ lệ tham gia & Pace toàn công ty.
📈 <code>/bxh_butpha [tuần] [top]</code> - BXH VĐV bứt phá tiến bộ nhất (VD: <code>/bxh_butpha 3 20</code>).
⚡ <code>/best-pace [tuần] [top]</code> - Xem Top bài chạy Pace tốt nhất (VD: <code>/best-pace 1 50</code>).
🥇 <code>/speed_tuan1</code> - Vinh danh Giải Cá Nhân Tuần 1 (Nam 30km, Nữ 15km).
⚡ <code>/giai_tuan1</code> - Xem BXH Giải Tập Thể Tuần 1 (Tỷ lệ % tham gia >= 3km).
🏃 <code>/giai_tuan2</code> - Xem BXH Giải Tập Thể Tuần 2 (Pace Đội - Ưu đãi Nữ -1 min/km).
🚀 <code>/giai_tuan3</code> - Xem BXH Giải Tuần 3 (Bứt phá Cá nhân & Tập thể).
🏁 <code>/giai_tuan4</code> - Xem BXH Giải Tập Thể Về Đích (Avg Km Cả Giải).
🏓 <code>/cong_pickleball [Nicknames...]</code> - BTC cộng điểm thưởng Pickleball (+5km Nam, +3km Nữ).
🏥 <code>/nghi_om [tuần] [Nicknames...]</code> - BTC duyệt nghỉ ốm/miễn trừ theo tuần (VD: <code>/nghi_om 3 CapyLong</code>).
🏥 <code>/ds_nghi_om [tuần]</code> - Xem danh sách VĐV nghỉ ốm/miễn trừ theo tuần.
📊 <code>/excel_bxh [tuần] [min_km]</code> - Xuất Excel BXH VĐV (VD: <code>/excel_bxh tuan3 3</code> hoặc <code>/excel_bxh 3 3</code>).
📄 <code>/excel_vipham [tuan1-4/doi1-8/tatca]</code> - Trích xuất file Excel danh sách bài vi phạm.
🔄 <code>/sync [Nickname/all]</code> - Đồng bộ bài chạy mới từ Strava (VD: <code>/sync CapyLong</code> hoặc <code>/sync</code>).
✅ <code>/duyet [IDs]</code> - BTC duyệt bài chạy hợp lệ theo danh sách IDs.
❌ <code>/huy [IDs]</code> - BTC từ chối bài chạy phạm quy theo danh sách IDs.
❓ <code>/help</code> - Hướng dẫn sử dụng Bot.

🔗 <b>Trang đăng ký:</b> Truy cập <a href="${env.APP_BASE_URL}">${env.APP_BASE_URL}</a> để liên kết tài khoản Strava!`;

      return ctx.replyWithHTML(text);
    });

    // Command /bxh_phong or /bxh_phongban or /phong [tuần / Tên_Phòng / Tên_Phòng tuần]
    bot.command(['bxh_phong', 'bxh_phongban', 'phong'], async (ctx) => {
      try {
        const rawText = (ctx.message?.text || '').trim();
        const parts = rawText.split(/\s+/).slice(1);

        let searchDept: string | null = null;
        let weekParam: number | string | null = null;

        if (parts.length === 0) {
          searchDept = null;
          weekParam = null;
        } else if (parts.length === 1) {
          const p = parts[0].toLowerCase();
          const matchWeekOnly = p.match(/^(?:tuan|w|tuần)?([1-4])$/) || p.match(/^(tatca|all)$/);
          if (matchWeekOnly) {
            weekParam = matchWeekOnly[1];
          } else {
            searchDept = parts[0];
          }
        } else if (parts.length === 2 && /^(?:tuan|w|tuần)$/i.test(parts[0]) && /^[1-4]$/.test(parts[1])) {
          weekParam = parseInt(parts[1], 10);
        } else {
          const lastWord = parts[parts.length - 1].toLowerCase();
          const secondLastWord = parts.length >= 3 ? parts[parts.length - 2].toLowerCase() : '';

          if (/^[1-4]$/.test(lastWord)) {
            if (/^(?:tuan|w|tuần)$/i.test(secondLastWord)) {
              weekParam = parseInt(lastWord, 10);
              searchDept = parts.slice(0, parts.length - 2).join(' ');
            } else {
              weekParam = parseInt(lastWord, 10);
              searchDept = parts.slice(0, parts.length - 1).join(' ');
            }
          } else if (/^(?:tuan|w|tuần)[1-4]$/i.test(lastWord)) {
            const num = lastWord.match(/\d+/);
            if (num) weekParam = parseInt(num[0], 10);
            searchDept = parts.slice(0, parts.length - 1).join(' ');
          } else {
            searchDept = parts.join(' ');
          }
        }

        if (!searchDept) {
          // View summary leaderboard across all departments
          const res = await getDepartmentSummaryLeaderboard(weekParam);
          const isWeekly = res.weekNumber !== null;

          let header = `🏢 <b>BẢNG XẾP HẠNG TIẾN ĐỘ PHÒNG BAN (${escapeHtml(res.periodTitle.toUpperCase())})</b> 🏢\n`;
          if (isWeekly) {
            header += `📌 <i>Chỉ tiêu: VĐV đạt tích lũy >= 3.00 km trong tuần</i>\n`;
          } else {
            header += `📌 <i>Chỉ tiêu tích lũy cả giải: Nam 30km, Nữ 15km</i>\n`;
          }
          header += `📊 <b>Toàn công ty:</b> <code>${res.totalQualifiedUsers}/${res.totalCompanyUsers} VĐV</code> (<b>${res.companyCompletionRate.toFixed(1)}%</b>)\n\n`;

          if (res.departments.length === 0) {
            return ctx.replyWithHTML(header + '<i>Chưa có dữ liệu phòng ban.</i>');
          }

          const itemLines = res.departments.map((dept, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>#${index + 1}.</b>`;
            let line = `${medal} <b>${escapeHtml(dept.departmentName)}</b>\n`;
            line += `   📊 Đạt: <code>${dept.qualifiedMembers}/${dept.totalMembers} VĐV</code> (<b>${dept.qualifiedRate.toFixed(1)}%</b>) | 🏃 <code>${dept.totalDistanceKm.toFixed(1)} km</code> (TB: <code>${dept.avgKmPerMember.toFixed(2)} km</code>)\n`;
            
            if (dept.unqualifiedMembers && dept.unqualifiedMembers.length > 0) {
              const unqList = dept.unqualifiedMembers
                .map(m => `<b>${escapeHtml(m.fullName || m.nickName)}</b> (<code>${m.currentKm.toFixed(1)}/${m.targetKm}km</code>)`)
                .join(', ');
              line += `   ⚠️ <i>Chưa đạt (${dept.unqualifiedMembers.length} người):</i> ${unqList}\n`;
            } else if (dept.totalMembers > 0) {
              line += `   🎉 <i>100% Phòng ban đã hoàn thành chỉ tiêu!</i>\n`;
            }
            return line;
          });

          const footer = `\n💡 <i>Mẹo: Gõ <code>/bxh_phong 3</code> để xem Tuần 3, hoặc <code>/bxh_phong Kỹ thuật 3</code> để xem chi tiết từng VĐV!</i>`;
          await sendChunkedHtmlMessages(ctx, header, itemLines, footer);
          return;
        }

        // View detailed member breakdown for a specific department
        const detail = await getDepartmentMembersDetail(searchDept, weekParam);
        if (!detail) {
          return ctx.replyWithHTML(`⚠️ Không tìm thấy phòng ban nào chứa tên <b>"${escapeHtml(searchDept)}"</b>.`);
        }

        const isWeekly = detail.weekNumber !== null;
        let header = `🏢 <b>CHI TIẾT PHÒNG BAN: ${escapeHtml(detail.departmentName.toUpperCase())}</b> 🏢\n`;
        header += `📌 <b>Khung thời gian:</b> ${escapeHtml(detail.periodTitle)}\n`;
        header += `📊 <b>Đạt chỉ tiêu:</b> <code>${detail.qualifiedMembers}/${detail.totalMembers} VĐV</code> (<b>${detail.qualifiedRate.toFixed(1)}%</b>)\n`;
        header += `🏃 <b>Tổng quãng đường:</b> <code>${detail.totalDistanceKm.toFixed(1)} km</code> | TB: <code>${detail.avgKmPerMember.toFixed(2)} km/người</code>\n\n`;
        header += `👥 <b>DANH SÁCH CHI TIẾT TỪNG VĐV:</b>\n`;

        const itemLines = detail.members.map((m, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<b>${idx + 1}.</b>`;
          const statusIcon = m.isExempt ? '🏥 [Nghỉ ốm]' : (m.isQualified ? '✅' : '⏳');
          const paceStr = m.runCount > 0 && isFinite(m.avgPaceSecPerKm) ? formatPace(m.avgPaceSecPerKm) : '--:--';
          const genderIcon = m.gender === 'FEMALE' ? '👩' : '👨';
          const teamName = getTeamName(m.teamId);

          return `${medal} ${statusIcon} <b>${escapeHtml(m.fullName || m.nickName)}</b> (@${escapeHtml(m.nickName)}) ${genderIcon}\n   └─ <code>${m.totalDistanceKm.toFixed(2)} km</code> | ${m.runCount} bài | Pace: <code>${paceStr}</code> (${escapeHtml(teamName)})\n`;
        });

        await sendChunkedHtmlMessages(ctx, header, itemLines);
        return;
      } catch (error) {
        console.error('[Bot /bxh_phong] Error:', error);
        return ctx.reply('Lỗi khi tải Bảng xếp hạng phòng ban.');
      }
    });

    // Command /bxh_doi [1-8/tuần] or /doi [1-8/tuần] - Team Leaderboards & Detailed Weekly Breakdown
    bot.command(['bxh_doi', 'doi'], async (ctx) => {
      try {
        const rawText = (ctx.message?.text || '').trim();
        const parts = rawText.split(/\s+/).slice(1);

        let teamIdArg: number | null = null;
        let weekNumArg: number | null = null;

        if (parts.length === 1) {
          const p = parts[0].toLowerCase();
          if (/^(?:tuan|w|tuần)[1-4]$/i.test(p)) {
            const num = p.match(/\d+/);
            if (num) weekNumArg = parseInt(num[0], 10);
          } else if (p === 'tatca' || p === 'all') {
            weekNumArg = null;
          } else {
            const num = parseInt(p, 10);
            if (!isNaN(num)) {
              if (num >= 5 && num <= 8) {
                teamIdArg = num;
              } else if (num >= 1 && num <= 4) {
                weekNumArg = num;
              }
            }
          }
        } else if (parts.length >= 2) {
          const num1 = parseInt(parts[0].replace(/[^\d]/g, ''), 10);
          const num2 = parseInt(parts[1].replace(/[^\d]/g, ''), 10);

          if (!isNaN(num1) && num1 >= 1 && num1 <= 8) {
            teamIdArg = num1;
          }
          if (!isNaN(num2) && num2 >= 1 && num2 <= 4) {
            weekNumArg = num2;
          }
        }

        // Case 1: Detailed athlete-by-athlete list for a SPECIFIC team
        if (teamIdArg !== null) {
          const detail = await getTeamWeekDetail(teamIdArg, weekNumArg);
          if (!detail) {
            return ctx.replyWithHTML(`⚠️ Không tìm thấy thông tin cho <b>Đội ${teamIdArg}</b>.`);
          }

          const isWeekly = detail.weekNumber !== null;
          let message = `🛡️ <b>CHI TIẾT ĐỘI THI: ${escapeHtml(detail.teamName.toUpperCase())}</b> 🛡️\n`;
          message += `📌 <b>Khung thời gian:</b> ${escapeHtml(detail.weekName)}\n`;
          if (isWeekly) {
            const qualifiedRate = detail.totalMembers > 0 ? (detail.qualifiedMembers / detail.totalMembers) * 100 : 0;
            message += `📊 <b>Đạt chỉ tiêu (>= 3km):</b> <code>${detail.qualifiedMembers}/${detail.totalMembers} VĐV</code> (<b>${qualifiedRate.toFixed(1)}%</b>)\n`;
          } else {
            const qualifiedRate = detail.totalMembers > 0 ? (detail.qualifiedMembers / detail.totalMembers) * 100 : 0;
            message += `📊 <b>Đạt đích chiến dịch:</b> <code>${detail.qualifiedMembers}/${detail.totalMembers} VĐV</code> (<b>${qualifiedRate.toFixed(1)}%</b>)\n`;
          }
          message += `🏃 <b>Tổng quãng đường đội:</b> <code>${detail.totalTeamDistanceKm.toFixed(1)} km</code>\n\n`;
          message += `👥 <b>DANH SÁCH CHI TIẾT TỪNG THÀNH VIÊN:</b>\n`;

          detail.members.forEach((m, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `<b>${idx + 1}.</b>`;
            const statusIcon = m.isExempt ? '🏥 [Nghỉ ốm]' : (m.isQualified ? '✅' : '❌');
            const paceStr = m.runCount > 0 && isFinite(m.avgPaceSecPerKm) ? formatPace(m.avgPaceSecPerKm) : '--:--';
            const genderIcon = m.gender === 'FEMALE' ? '👩' : '👨';

            message += `${medal} ${statusIcon} <b>${escapeHtml(m.fullName || m.nickName)}</b> (@${escapeHtml(m.nickName)}) ${genderIcon}\n`;
            message += `   └─ <code>${m.totalDistanceKm.toFixed(2)} km</code> | ${m.runCount} bài | Pace: <code>${paceStr}</code>\n`;
          });

          return ctx.replyWithHTML(message);
        }

        // Case 2: Summary Leaderboard of ALL 08 Teams (with week filter & >= 3km progress)
        const res = await getTeamWeeklyLeaderboard(weekNumArg);
        const isWeekly = res.weekNumber !== null;

        let message = `🛡️ <b>BẢNG XẾP HẠNG TIẾN ĐỘ 08 ĐỘI THI (${escapeHtml(res.periodTitle.toUpperCase())})</b> 🛡️\n`;
        if (isWeekly) {
          message += `📌 <i>Chỉ tiêu: VĐV đạt tích lũy >= 3.00 km trong tuần</i>\n`;
        } else {
          message += `📌 <i>Chỉ tiêu tích lũy cả giải: Nam 30km, Nữ 15km</i>\n`;
        }
        message += `📊 <b>Toàn công ty:</b> <code>${res.totalQualifiedUsers}/${res.totalCompanyUsers} VĐV</code> (<b>${res.companyCompletionRate.toFixed(1)}%</b>)\n\n`;

        res.teams.forEach((team, index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<b>#${index + 1}.</b>`;
          message += `${medal} <b>${escapeHtml(team.teamName)}</b>\n`;
          message += `   📊 Đạt: <code>${team.qualifiedMembers}/${team.totalMembers} VĐV</code> (<b>${team.qualifiedRate.toFixed(1)}%</b>) | 🏃 <code>${team.totalDistanceKm.toFixed(1)} km</code> (TB: <code>${team.avgKmPerMember.toFixed(2)} km</code>)\n`;
          
          if (team.unqualifiedMembers && team.unqualifiedMembers.length > 0) {
            const unqList = team.unqualifiedMembers
              .map(m => `<b>${escapeHtml(m.fullName || m.nickName)}</b> (<code>${m.currentKm.toFixed(1)}/${m.targetKm}km</code>)`)
              .join(', ');
            message += `   ⚠️ <i>Chưa đạt (${team.unqualifiedMembers.length} người):</i> ${unqList}\n`;
          } else if (team.totalMembers > 0) {
            message += `   🎉 <i>100% Đội đã hoàn thành chỉ tiêu!</i>\n`;
          }
        });

        message += `\n💡 <i>Mẹo: Gõ <code>/bxh_doi 3</code> để xem Tuần 3, hoặc <code>/doi 1 3</code> để xem chi tiết từng VĐV Đội 1!</i>`;
        return ctx.replyWithHTML(message);
      } catch (error) {
        console.error('[Bot /bxh_doi] Error:', error);
        return ctx.reply('Lỗi khi tải Bảng xếp hạng đội thi.');
      }
    });

    // Command /nhacnho [tuần] [min_km] [đội] or /thieubai [tuần] [min_km] - List athletes missing a single activity >= minKm
    bot.command(['nhacnho', 'nhac_nho', 'thieubai', 'chuanhac'], async (ctx) => {
      try {
        const rawText = (ctx.message?.text || '').trim();
        const parts = rawText.split(/\s+/).slice(1);

        let weekParam: number | string | null = null;
        let minKmParam: number | null = null;
        let teamIdParam: number | null = null;

        if (parts.length === 1) {
          const p = parts[0].toLowerCase();
          if (/^(?:tuan|w|tuần)?([1-4])$/i.test(p)) {
            const num = p.match(/\d+/);
            if (num) weekParam = parseInt(num[0], 10);
          } else {
            const num = parseFloat(p.replace(/[^\d.]/g, ''));
            if (!isNaN(num)) {
              if (num >= 1 && num <= 4) weekParam = num;
              else minKmParam = num;
            }
          }
        } else if (parts.length === 2) {
          const num1 = parseInt(parts[0].replace(/[^\d]/g, ''), 10);
          const num2 = parseFloat(parts[1].replace(/[^\d.]/g, ''));
          if (!isNaN(num1) && num1 >= 1 && num1 <= 4) weekParam = num1;
          if (!isNaN(num2) && num2 > 0) minKmParam = num2;
        } else if (parts.length >= 3) {
          const num1 = parseInt(parts[0].replace(/[^\d]/g, ''), 10);
          const num2 = parseFloat(parts[1].replace(/[^\d.]/g, ''));
          const num3 = parseInt(parts[2].replace(/[^\d]/g, ''), 10);
          if (!isNaN(num1) && num1 >= 1 && num1 <= 4) weekParam = num1;
          if (!isNaN(num2) && num2 > 0) minKmParam = num2;
          if (!isNaN(num3) && num3 >= 1 && num3 <= 8) teamIdParam = num3;
        }

        const res = await getWeeklyActivityReminderList({
          week: weekParam,
          minKm: minKmParam,
          teamId: teamIdParam
        });

        let header = `📢 <b>DANH SÁCH VĐV CẦN NHẮC NHỞ (${escapeHtml(res.weekName.toUpperCase())})</b> 📢\n`;
        header += `📌 <b>Tiêu chí:</b> <i>Chưa có bài chạy đơn lẻ nào >= ${res.minKm.toFixed(2)} km trong tuần</i>\n`;
        header += `📊 <b>Toàn công ty:</b> <code>${res.totalMissingUsers}/${res.totalCompanyUsers} VĐV</code> cần hoàn thành bài chạy\n\n`;

        const itemLines: string[] = [];

        res.teams.forEach(team => {
          let teamBlock = `🛡️ <b>${escapeHtml(team.teamName)}</b> (<code>${team.missingCount}/${team.totalActiveMembers} VĐV</code>)\n`;
          if (team.missingAthletes.length === 0) {
            teamBlock += `   🎉 <i>100% Đội đã có bài chạy >= ${res.minKm.toFixed(1)}km!</i>\n\n`;
          } else {
            team.missingAthletes.forEach((m, idx) => {
              const genderIcon = m.gender === 'FEMALE' ? '👩' : '👨';
              const maxStr = m.runCountInWeek > 0 ? `Bài dài nhất: ${m.maxSingleActivityKm.toFixed(2)}km (${m.runCountInWeek} bài)` : 'Chưa chạy bài nào';
              teamBlock += `   ${idx + 1}. <b>${escapeHtml(m.fullName || m.nickName)}</b> (@${escapeHtml(m.nickName)}) ${genderIcon}\n      └─ <code>${maxStr}</code> | Tổng tuần: <code>${m.totalDistanceInWeekKm.toFixed(2)} km</code>\n`;
            });
            teamBlock += '\n';
          }
          itemLines.push(teamBlock);
        });

        const footer = `💡 <i>Mẹo: Gõ <code>/nhacnho 3 3</code> xem Tuần 3 mốc 3km, hoặc <code>/nhacnho 3 5</code> xem mốc 5km!</i>`;
        await sendChunkedHtmlMessages(ctx, header, itemLines, footer);
      } catch (error) {
        console.error('[Bot /nhacnho] Error:', error);
        return ctx.reply('Lỗi khi tải danh sách nhắc nhở bài chạy.');
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



    // Command /sync [Nickname / Họ Tên / all / tatca] - Active Manual Sync (Individual or All Athletes)
    bot.command('sync', async (ctx) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);
        const searchTarget = parts.join(' ').trim();

        if (searchTarget && searchTarget.toLowerCase() !== 'all' && searchTarget.toLowerCase() !== 'tatca') {
          // Sync a specific user
          const cleanTarget = searchTarget.startsWith('@') ? searchTarget.slice(1) : searchTarget;
          const targetUser = await db.user.findFirst({
            where: {
              OR: [
                { nickName: { equals: cleanTarget, mode: 'insensitive' } },
                { nickName: { contains: cleanTarget, mode: 'insensitive' } },
                { fullName: { contains: cleanTarget, mode: 'insensitive' } }
              ]
            }
          });

          if (!targetUser) {
            return ctx.replyWithHTML(`⚠️ Không tìm thấy VĐV nào khớp với từ khóa <b>"${escapeHtml(searchTarget)}"</b>.`);
          }

          if (!targetUser.stravaAthleteId) {
            return ctx.replyWithHTML(`⚠️ VĐV <b>${escapeHtml(targetUser.fullName || targetUser.nickName)}</b> (@${escapeHtml(targetUser.nickName)}) chưa liên kết tài khoản Strava.`);
          }

          await ctx.replyWithHTML(`⏳ <i>Đang kéo dữ liệu bài chạy mới nhất từ Strava cho VĐV <b>${escapeHtml(targetUser.fullName || targetUser.nickName)}</b> (@${escapeHtml(targetUser.nickName)})...</i>`);

          const res = await syncUserPastActivities(targetUser.id);
          const updatedUser = await db.user.findUnique({ where: { id: targetUser.id } });
          const finalKm = updatedUser ? (updatedUser.totalDistance / 1000).toFixed(2) : (targetUser.totalDistance / 1000).toFixed(2);

          let syncDetailMsg = `🔄 <b>ĐỒNG BỘ THÀNH CÔNG!</b> 🔄\n\n` +
            `👤 <b>VĐV:</b> ${escapeHtml(targetUser.fullName || targetUser.nickName)} (@${escapeHtml(targetUser.nickName)})\n` +
            `🛡️ <b>Đội:</b> ${escapeHtml(getTeamName(targetUser.teamId))}\n` +
            `📥 <b>Bài chạy mới ghi nhận:</b> <code>${res.syncedCount} bài</code>\n`;
          if (res.updatedCount > 0) {
            syncDetailMsg += `✂️ <b>Bài cập nhật (cắt gọt/sửa):</b> <code>${res.updatedCount} bài</code>\n`;
          }
          syncDetailMsg += `🗑️ <b>Bài chạy bị xóa trên Strava:</b> <code>${res.deletedCount} bài</code>\n` +
            `🏃 <b>Tổng quãng đường hiện tại:</b> <code>${finalKm} km</code>`;

          return ctx.replyWithHTML(syncDetailMsg);
        }

        // Sync ALL users in background (Non-Blocking)
        await ctx.replyWithHTML('⏳ <b>ĐÃ KÍCH HOẠT ĐỒNG BỘ NỀN!</b>\n\nTiến trình đồng bộ dữ liệu bài chạy quá khứ cho toàn bộ VĐV đang được thực thi trong nền (background). Hệ thống sẽ gửi tin nhắn báo cáo tổng kết ngay khi hoàn tất.');
        
        syncAllUsersPastActivities().then(async (res) => {
          if (res.isAlreadyRunning) {
            await sendTelegramMessage(
              env.TELEGRAM_GROUP_ID,
              '⚠️ <b>THÔNG BÁO:</b> Tiến trình đồng bộ dữ liệu toàn bộ VĐV hiện đang chạy. Vui lòng chờ tiến trình trước hoàn tất!'
            );
            return;
          }

          let summaryText = 
`🔄 <b>ĐỒNG BỘ DỮ LIỆU HOÀN TẤT!</b> 🔄

📊 Đã đối soát: <b>${res.totalUsers}</b> vận động viên.
🏃 Đã nạp & xử lý mới: <b>${res.totalSynced}</b> bài chạy active từ Strava.\n`;
          if (res.totalUpdated > 0) {
            summaryText += `✂️ Đã cập nhật (cắt gọt/sửa): <b>${res.totalUpdated}</b> bài chạy.\n`;
          }
          summaryText += `🧹 Đã dọn dẹp & trừ km: <b>${res.totalDeleted}</b> bài đã bị xóa trên Strava.

Gõ <code>/bxh_canhan</code> hoặc <code>/bxh_doi</code> để xem Bảng xếp hạng mới nhất!`;

          await sendTelegramMessage(env.TELEGRAM_GROUP_ID, summaryText);
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
          return ctx.replyWithHTML(`🏃 <b>TOP BÀI CHẠY PACE TỐT NHẤT (${escapeHtml(res.weekTitle.toUpperCase())})</b>\n\n<i>Chưa có bài chạy hợp lệ từ 3km trở lên trong khoảng thời gian này.</i>`);
        }

        const header = `⚡ <b>TOP ${res.activities.length} BÀI CHẠY PACE TỐT NHẤT (${escapeHtml(res.weekTitle.toUpperCase())} - TỪ 3KM TRỞ LÊN)</b> ⚡\n\n`;

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

    // Command /tonghop [tuần/tatca] or /thongke or /summary - Company-wide Summary Statistics
    const handleCompanySummary = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/);
        const weekParam = parts.length > 1 ? parts.slice(1).join(' ') : '';

        await ctx.reply(`📊 Đang tổng hợp báo cáo thống kê ${weekParam ? `cho "${weekParam}"` : 'toàn chiến dịch'}... Vui lòng đợi trong giây lát.`);

        const stats = await getCompanySummaryStats({ week: weekParam });

        let message = `📊 <b>BÁO CÁO TỔNG HỢP: ${escapeHtml(stats.periodTitle.toUpperCase())}</b> 📊\n\n`;

        message += `👥 <b>TỶ LỆ NHÂN SỰ ĐẠT CHUẨN (>= 3KM):</b>\n`;
        message += `   🏢 <b>Toàn công ty:</b> <code>${stats.qualifiedUsersCount}/${stats.totalCompanyUsers} VĐV</code> (<b>${stats.qualifiedRatePercent.toFixed(1)}%</b>)\n`;
        message += `   👨 <b>Nam:</b> <code>${stats.qualifiedMaleCount}/${stats.totalMaleUsers} người</code> (${stats.qualifiedMaleRatePercent.toFixed(1)}%)\n`;
        message += `   👩 <b>Nữ:</b> <code>${stats.qualifiedFemaleCount}/${stats.totalFemaleUsers} người</code> (${stats.qualifiedFemaleRatePercent.toFixed(1)}%)\n\n`;

        message += `⚡ <b>PACE TRUNG BÌNH (TÍNH TRÊN NHÓM VĐV >= 3KM):</b>\n`;
        const companyPaceStr = isFinite(stats.companyAvgPaceSecPerKm) ? formatPace(stats.companyAvgPaceSecPerKm) : 'Chưa có dữ liệu';
        const malePaceStr = isFinite(stats.maleAvgPaceSecPerKm) ? formatPace(stats.maleAvgPaceSecPerKm) : 'Chưa có dữ liệu';
        const femalePaceStr = isFinite(stats.femaleAvgPaceSecPerKm) ? formatPace(stats.femaleAvgPaceSecPerKm) : 'Chưa có dữ liệu';

        message += `   🏢 <b>Toàn công ty:</b> <code>${companyPaceStr}</code>\n`;
        message += `   👨 <b>Nam (${stats.qualifiedMaleCount} người):</b> <code>${malePaceStr}</code>\n`;
        message += `   👩 <b>Nữ (${stats.qualifiedFemaleCount} người):</b> <code>${femalePaceStr}</code>\n\n`;

        message += `🏃 <b>TỔNG QUY MÔ VẬN ĐỘNG:</b>\n`;
        message += `   └─ <b>Tổng quãng đường toàn công ty:</b> <code>${stats.totalDistanceKm.toFixed(1)} km</code>\n`;
        message += `   └─ <b>Quãng đường nhóm đạt chuẩn:</b> <code>${stats.totalQualifiedDistanceKm.toFixed(1)} km</code>\n`;
        message += `   └─ <b>Tổng số bài chạy hợp lệ:</b> <code>${stats.totalActivitiesCount} bài</code>\n\n`;

        message += `💡 <i>Mẹo: Gõ <code>/tonghop 1</code>, <code>/tonghop 2</code>, <code>/tonghop 3</code>, <code>/tonghop 4</code> hoặc <code>/tonghop tatca</code> để xem theo từng tuần!</i>`;

        return ctx.replyWithHTML(message);
      } catch (error: any) {
        console.error('[Bot /tonghop] Error:', error);
        return ctx.reply('Lỗi khi tổng hợp báo cáo thống kê: ' + (error?.message || error));
      }
    };

    bot.command(['tonghop', 'thongke', 'summary'], handleCompanySummary);

    // Command /bxh_butpha [tuần] [top] or /butpha or /but_pha - Distance Growth Leaderboard between weeks
    const handleGrowthLeaderboard = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);

        let targetWeek: string | number = 3;
        let baseWeek: string | number | undefined = undefined;
        let limit: string | number = 10;

        if (parts.length === 1) {
          const p1 = parseInt(parts[0], 10);
          if (!isNaN(p1)) {
            if (p1 >= 2 && p1 <= 4) {
              targetWeek = p1;
            } else if (p1 > 4) {
              limit = p1;
            }
          }
        } else if (parts.length >= 2) {
          const p1 = parseInt(parts[0], 10);
          const p2 = parseInt(parts[1], 10);
          if (!isNaN(p1) && p1 >= 2 && p1 <= 4) {
            targetWeek = p1;
            if (!isNaN(p2)) {
              if (parts.length >= 3) {
                baseWeek = p2;
                limit = parseInt(parts[2], 10) || 10;
              } else {
                limit = p2;
              }
            }
          } else if (!isNaN(p1) && p1 > 4) {
            limit = p1;
          }
        }

        const res = await getGrowthLeaderboard({ targetWeek, baseWeek, limit });

        if (res.rankings.length === 0) {
          return ctx.replyWithHTML(`📈 <b>BẢNG XẾP HẠNG BỨT PHÁ (${escapeHtml(res.targetWeekName.toUpperCase())} vs ${escapeHtml(res.baseWeekName.toUpperCase())}):</b>\n\nℹ️ Chưa có VĐV nào có quãng đường tăng trưởng dương trong kỳ này.`);
        }

        const messagesToSend: string[] = [];
        let currentMessage = `📈 <b>BẢNG XẾP HẠNG BỨT PHÁ TIẾN BỘ QUÃNG ĐƯỜNG</b> 📈\n`;
        currentMessage += `<i>(So sánh: ${escapeHtml(res.targetWeekName)} vs ${escapeHtml(res.baseWeekName)} | Top ${res.limit} VĐV bứt phá nhất)</i>\n\n`;

        res.rankings.forEach((item, index) => {
          const medal = index === 0 ? '👑 TOP 1' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          const athleteName = escapeHtml(item.user.fullName || item.user.nickName);
          const teamName = escapeHtml(getTeamName(item.user.teamId));
          const deltaFormatted = item.deltaKm >= 0 ? `+${item.deltaKm.toFixed(2)}` : `${item.deltaKm.toFixed(2)}`;
          const percentStr = item.growthPercent !== null ? ` (+${item.growthPercent.toFixed(0)}%)` : '';

          let entry = `${medal} <b>${athleteName}</b> (@${escapeHtml(item.user.nickName)} - ${teamName})\n`;
          entry += `   └─ 🚀 <b>Tăng: <code>${deltaFormatted} km</code></b>${percentStr} (T${res.targetWeekNum}: ${item.targetWeekKm.toFixed(1)}km | T${res.baseWeekNum}: ${item.baseWeekKm.toFixed(1)}km)\n`;

          if (currentMessage.length + entry.length > 3800) {
            messagesToSend.push(currentMessage);
            currentMessage = entry;
          } else {
            currentMessage += entry;
          }
        });

        const tip = `\n💡 <i>Mẹo: Gõ <code>/bxh_butpha 3 20</code> để xem Top 20 Tuần 3, hoặc <code>/bxh_butpha 2 10</code> để xem Tuần 2!</i>`;
        if (currentMessage.length + tip.length > 3800) {
          messagesToSend.push(currentMessage);
          messagesToSend.push(tip);
        } else {
          currentMessage += tip;
          messagesToSend.push(currentMessage);
        }

        for (const msg of messagesToSend) {
          await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
        }
      } catch (error: any) {
        console.error('[Bot /bxh_butpha] Error:', error);
        return ctx.reply('Lỗi khi tải Bảng xếp hạng bứt phá: ' + (error?.message || error));
      }
    };

    bot.command(['bxh_butpha', 'butpha', 'but_pha'], handleGrowthLeaderboard);

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
        message += `<i>(ĐK cần: 100% VĐV đạt >= 3km | Ưu đãi Nữ: giảm 1 min/km khi tổng kết)</i>\n\n`;

        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 TOP 1 (1.000.000đ)' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          const statusTag = t.is100PercentParticipated ? '✅ (100% Đạt >= 3km)' : `❌ (${t.participantCount}/${t.totalMembers} VĐV đạt >= 3km)`;
          const paceStr = formatPace(t.averagePaceSecPerKm);

          message += `${medal} <b>${escapeHtml(t.teamName)}</b> ${statusTag}\n`;
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

        let message = `🚀 <b>GIẢI TUẦN 3: TĂNG TỐC & BỨT PHÁ GIỚI HẠN</b> 🚀\n`;
        message += `<i>(Điều kiện hợp lệ: Mỗi bài chạy phải đạt tối thiểu >= 3.00 km)</i>\n\n`;

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
        let message = `🏁 <b>GIẢI TẬP THỂ TUẦN 4: VỀ ĐÍCH (AVG KM/NGƯỜI CẢ GIẢI)</b> 🏁\n`;
        message += `<i>(Tính trên thành tích cả giải của các thành viên chính thức, loại trừ người miễn trừ Tuần 4)</i>\n\n`;

        teams.forEach((t, index) => {
          const medal = index === 0 ? '👑 GIẢI NHẤT TẬP THỂ (1.000.000đ)' : index === 1 ? '🥈 TOP 2' : index === 2 ? '🥉 TOP 3' : `<b>#${index + 1}</b>`;
          const exemptNote = (t.exemptCount && t.exemptCount > 0) ? ` | 🏥 Miễn trừ: ${t.exemptCount}` : '';
          message += `${medal} <b>${escapeHtml(t.teamName)}</b>\n`;
          message += `   📊 TB cả giải: <code>${t.avgKmPerMember.toFixed(2)} km/người</code> (Tổng ${t.totalKmWholeContest.toFixed(1)}km / ${t.totalMembers} VĐV${exemptNote})\n`;
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

    // Command /excel_bxh & /bxh_excel - Leaderboard Excel Export (Week or All-time + Min Km Filter)
    const handleLeaderboardExcelExport = async (ctx: any) => {
      try {
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/).slice(1);
        
        let weekParam = 'tatca';
        let minKmParam: string | undefined = undefined;

        if (parts.length === 1) {
          weekParam = parts[0];
        } else if (parts.length >= 2) {
          weekParam = parts[0];
          minKmParam = parts[1];
        }

        const filterDisplay = minKmParam ? `${weekParam} (Bài >= ${minKmParam}km)` : weekParam;
        await ctx.reply(`📊 Đang trích xuất Bảng Xếp Hạng Excel theo bộ lọc "${filterDisplay}"... Vui lòng đợi trong giây lát.`);

        const result = await exportLeaderboardToExcelBuffer(weekParam, minKmParam);

        await ctx.replyWithDocument(
          { source: result.buffer, filename: result.filename },
          { caption: `📄 <b>EXCEL BẢNG XẾP HẠNG VẬN ĐỘNG VIÊN</b>\n📌 <b>Bộ lọc:</b> ${result.filterTitle}\n📊 <b>Tổng số VĐV:</b> <code>${result.totalRecords} người</code>\n💡 <i>Mẹo: Gõ <code>/excel_bxh tuan3 3</code> để lọc Tuần 3 bài >= 3km, hoặc <code>/excel_bxh tatca</code> để xuất cả giải!</i>`, parse_mode: 'HTML' }
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
        return ctx.replyWithHTML(`📊 <b>THỐNG KÊ BÀI CHẠY VI PHẠM:</b>\n\nHệ thống đang lưu trữ <b>${count} bài chạy</b> vi phạm giữ nguyên trạng thái bị loại Bỏ.`);
      } catch (error: any) {
        console.error('[Bot /huy_tatca] Error:', error);
        return ctx.reply('Lỗi khi xác nhận hủy toàn bộ.');
      }
    });
    // Command /cong_pickleball <Nick1> <Nick2> ... - Grant +5km (Male) or +3km (Female) Pickleball bonus in Week 3
    const handlePickleballBonus = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);

        if (parts.length === 0) {
          let msg = `🏓 <b>HƯỚNG DẪN CỘNG ĐIỂM THƯỞNG PICKLEBALL TUẦN 3:</b>\n\n`;
          msg += `BTC hãy nhập danh sách Nickname hoặc Họ tên VĐV sau câu lệnh <code>/cong_pickleball</code>.\n\n`;
          msg += `<i>Quy tắc thưởng:</i>\n`;
          msg += `   👨 <b>Nam:</b> <code>+5.00 km</code> (Pace 6:00)\n`;
          msg += `   👩 <b>Nữ:</b> <code>+3.00 km</code> (Pace 6:00)\n\n`;
          msg += `<i>Ví dụ:</i> <code>/cong_pickleball HanaMichi Badboyz BachHop</code>`;
          return ctx.replyWithHTML(msg);
        }

        const results = await grantPickleballBonus(parts);

        let msg = `🏓 <b>KẾT QUẢ CỘNG ĐIỂM THƯỞNG PICKLEBALL TUẦN 3:</b>\n\n`;
        results.forEach((r) => {
          const icon = r.success ? '✅' : '⚠️';
          const displayName = r.fullName ? `<b>${escapeHtml(r.fullName)}</b> (@${escapeHtml(r.nickname)})` : `<b>${escapeHtml(r.nickname)}</b>`;
          msg += `${icon} ${displayName}: ${escapeHtml(r.message)}\n`;
        });

        return ctx.replyWithHTML(msg);
      } catch (error: any) {
        console.error('[Bot /cong_pickleball] Error:', error);
        return ctx.reply('Lỗi khi cộng điểm thưởng Pickleball: ' + (error?.message || error));
      }
    };

    bot.command(['cong_pickleball', 'bonus_pickleball'], handlePickleballBonus);

    // Command /huy_pickleball <Nick1> <Nick2> ... - Revoke Pickleball bonus in Week 3
    bot.command('huy_pickleball', async (ctx) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);

        if (parts.length === 0) {
          let msg = `⚠️ <b>HƯỚNG DẪN THU HỒI ĐIỂM THƯỞNG PICKLEBALL:</b>\n\n`;
          msg += `BTC hãy nhập danh sách Nickname cần thu hồi sau câu lệnh <code>/huy_pickleball</code>.\n`;
          msg += `<i>Ví dụ:</i> <code>/huy_pickleball HanaMichi Badboyz</code>`;
          return ctx.replyWithHTML(msg);
        }

        const results = await revokePickleballBonus(parts);

        let msg = `🏓 <b>KẾT QUẢ THU HỒI ĐIỂM THƯỞNG PICKLEBALL:</b>\n\n`;
        results.forEach((r) => {
          const icon = r.success ? '✅' : '⚠️';
          const displayName = r.fullName ? `<b>${escapeHtml(r.fullName)}</b> (@${escapeHtml(r.nickname)})` : `<b>${escapeHtml(r.nickname)}</b>`;
          msg += `${icon} ${displayName}: ${escapeHtml(r.message)}\n`;
        });

        return ctx.replyWithHTML(msg);
      } catch (error: any) {
        console.error('[Bot /huy_pickleball] Error:', error);
        return ctx.reply('Lỗi khi thu hồi điểm thưởng Pickleball: ' + (error?.message || error));
      }
    });

    // Command /nghi_om [tuần] [Nicknames...] - Register Weekly Sick Leave / Exemption
    const handleWeeklyExemption = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);

        if (parts.length < 2) {
          let msg = `🏥 <b>HƯỚNG DẪN ĐĂNG KÝ NGHỈ ỐM / MIỄN TRỪ THEO TUẦN:</b>\n\n`;
          msg += `Cú pháp: <code>/nghi_om [tuần 1-4] [Danh sách Nicknames hoặc Họ tên...]</code>\n\n`;
          msg += `<i>Ví dụ:</i> <code>/nghi_om 3 CapyLong ZuyHun HanaMichi</code>\n\n`;
          msg += `💡 <i>Tác dụng: VĐV nghỉ ốm trong tuần sẽ được trừ khỏi mẫu số thành viên của Đội/Phòng/Toàn công ty trong tuần đó (không làm tụt % hoặc Avg km của Đội) và được miễn phạt tuần đó!</i>`;
          return ctx.replyWithHTML(msg);
        }

        const weekNum = parseInt(parts[0].replace(/[^\d]/g, ''), 10);
        if (isNaN(weekNum) || weekNum < 1 || weekNum > 4) {
          return ctx.replyWithHTML(`⚠️ Số tuần không hợp lệ: <b>"${escapeHtml(parts[0])}"</b>. Vui lòng nhập số tuần từ 1 đến 4 (VD: <code>/nghi_om 3 CapyLong</code>).`);
        }

        const nicknames = parts.slice(1);
        const results = await grantWeeklyExemption(weekNum, nicknames);

        let msg = `🏥 <b>KẾT QUẢ XÁC NHẬN NGHỈ ỐM / MIỄN TRỪ TUẦN ${weekNum}:</b>\n\n`;
        results.forEach((r) => {
          const icon = r.success ? '✅' : '⚠️';
          const displayName = r.fullName ? `<b>${escapeHtml(r.fullName)}</b> (@${escapeHtml(r.nickname)})` : `<b>${escapeHtml(r.nickname)}</b>`;
          msg += `${icon} ${displayName}: ${escapeHtml(r.message)}\n`;
        });

        msg += `\n💡 <i>Gõ <code>/ds_nghi_om ${weekNum}</code> để xem danh sách nghỉ ốm Tuần ${weekNum}!</i>`;
        return ctx.replyWithHTML(msg);
      } catch (error: any) {
        console.error('[Bot /nghi_om] Error:', error);
        return ctx.reply('Lỗi khi đăng ký nghỉ ốm theo tuần: ' + (error?.message || error));
      }
    };

    bot.command(['nghi_om', 'nghiom', 'mien_tuan'], handleWeeklyExemption);

    // Command /huy_nghi_om [tuần] [Nicknames...] - Revoke Weekly Sick Leave
    const handleRevokeWeeklyExemption = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);

        if (parts.length < 2) {
          let msg = `⚠️ <b>HƯỚNG DẪN HỦY NGHỈ ỐM / MIỄN TRỪ THEO TUẦN:</b>\n\n`;
          msg += `Cú pháp: <code>/huy_nghi_om [tuần 1-4] [Danh sách Nicknames hoặc Họ tên...]</code>\n\n`;
          msg += `<i>Ví dụ:</i> <code>/huy_nghi_om 3 CapyLong</code>`;
          return ctx.replyWithHTML(msg);
        }

        const weekNum = parseInt(parts[0].replace(/[^\d]/g, ''), 10);
        if (isNaN(weekNum) || weekNum < 1 || weekNum > 4) {
          return ctx.replyWithHTML(`⚠️ Số tuần không hợp lệ: <b>"${escapeHtml(parts[0])}"</b>. Vui lòng nhập số tuần từ 1 đến 4 (VD: <code>/huy_nghi_om 3 CapyLong</code>).`);
        }

        const nicknames = parts.slice(1);
        const results = await revokeWeeklyExemption(weekNum, nicknames);

        let msg = `🏥 <b>KẾT QUẢ HỦY TRẠNG THÁI NGHỈ ỐM TUẦN ${weekNum}:</b>\n\n`;
        results.forEach((r) => {
          const icon = r.success ? '✅' : '⚠️';
          const displayName = r.fullName ? `<b>${escapeHtml(r.fullName)}</b> (@${escapeHtml(r.nickname)})` : `<b>${escapeHtml(r.nickname)}</b>`;
          msg += `${icon} ${displayName}: ${escapeHtml(r.message)}\n`;
        });

        return ctx.replyWithHTML(msg);
      } catch (error: any) {
        console.error('[Bot /huy_nghi_om] Error:', error);
        return ctx.reply('Lỗi khi hủy trạng thái nghỉ ốm: ' + (error?.message || error));
      }
    };

    bot.command(['huy_nghi_om', 'huynghiom', 'huy_mien_tuan'], handleRevokeWeeklyExemption);

    // Command /ds_nghi_om [tuần] - List of Exempt / Sick Leave Athletes
    const handleListWeeklyExemption = async (ctx: any) => {
      try {
        const text = (ctx.message?.text || '').trim();
        const parts = text.split(/\s+/).slice(1);

        let weekNum: number | null = null;
        if (parts.length > 0) {
          const parsed = parseInt(parts[0].replace(/[^\d]/g, ''), 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) {
            weekNum = parsed;
          }
        }

        const exemptions = await getWeeklyExemptionsList(weekNum);

        if (exemptions.length === 0) {
          const title = weekNum ? `trong Tuần ${weekNum}` : 'trong toàn bộ giải đấu';
          return ctx.replyWithHTML(`🏥 <b>DANH SÁCH VĐV NGHỈ ỐM / MIỄN TRỪ:</b>\n\nℹ️ Hiện tại không có VĐV nào được đánh dấu nghỉ ốm ${title}.`);
        }

        const title = weekNum ? `TUẦN ${weekNum}` : 'TẤT CẢ CÁC TUẦN';
        let msg = `🏥 <b>DANH SÁCH VĐV NGHỈ ỐM / MIỄN TRỪ (${title}):</b> 🏥\n\n`;

        exemptions.forEach((ex, idx) => {
          const genderIcon = ex.user.gender === 'FEMALE' ? '👩' : '👨';
          const teamName = getTeamName(ex.user.teamId);
          const deptName = ex.user.department ? ` - ${escapeHtml(ex.user.department)}` : '';
          const athleteName = ex.user.fullName ? `<b>${escapeHtml(ex.user.fullName)}</b> (@${escapeHtml(ex.user.nickName)})` : `<b>${escapeHtml(ex.user.nickName)}</b>`;
          
          msg += `${idx + 1}. ${genderIcon} ${athleteName} [Tuần ${ex.week}]\n`;
          msg += `   └─ 🛡️ ${escapeHtml(teamName)}${deptName} | 📝 <i>${escapeHtml(ex.reason || 'Nghỉ ốm')}</i>\n`;
        });

        msg += `\n📊 <b>Tổng số lượt miễn trừ:</b> <code>${exemptions.length} lượt</code>\n`;
        msg += `💡 <i>Cú pháp thêm: <code>/nghi_om [tuần] [Nicknames...]</code> | Hủy: <code>/huy_nghi_om [tuần] [Nicknames...]</code></i>`;

        return ctx.replyWithHTML(msg);
      } catch (error: any) {
        console.error('[Bot /ds_nghi_om] Error:', error);
        return ctx.reply('Lỗi khi tải danh sách nghỉ ốm: ' + (error?.message || error));
      }
    };

    bot.command(['ds_nghi_om', 'dsnghiom', 'ds_mien'], handleListWeeklyExemption);

    const launchBotWithRetry = (retryCount = 0) => {
      bot?.launch({ dropPendingUpdates: false }).then(() => {
        console.log('[Telegram Bot] IRIS Challenge Bot launched successfully!');
      }).catch((err) => {
        if (err.message?.includes('409')) {
          console.warn(`[Telegram Bot] 409 Conflict (Another bot instance running). Retrying in 5s... (Attempt ${retryCount + 1})`);
          setTimeout(() => launchBotWithRetry(retryCount + 1), 5000);
        } else {
          console.error('[Telegram Bot] Failed to launch bot:', err.message);
          setTimeout(() => launchBotWithRetry(retryCount + 1), 10000);
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
