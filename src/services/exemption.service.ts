import { db } from '../config/db';
import { findUserByFlexibleQuery } from './bonus.service';

export interface ExemptionResult {
  success: boolean;
  nickname: string;
  fullName?: string | null;
  week?: number;
  message: string;
}

/**
 * Grant sick leave / weekly exemption for a list of athlete nicknames in a specific week.
 */
export async function grantWeeklyExemption(
  weekNumber: number,
  nicknames: string[],
  reason: string = 'Nghỉ ốm / Miễn trừ tuần'
): Promise<ExemptionResult[]> {
  const results: ExemptionResult[] = [];

  if (weekNumber < 1 || weekNumber > 4) {
    return [{
      success: false,
      nickname: '',
      message: `Tuần ${weekNumber} không hợp lệ. Vui lòng chọn tuần từ 1 đến 4.`
    }];
  }

  for (const rawNick of nicknames) {
    const cleanNick = rawNick.trim().replace(/^@/, '');
    if (!cleanNick) continue;

    const user = await findUserByFlexibleQuery(cleanNick);
    if (!user) {
      results.push({
        success: false,
        nickname: cleanNick,
        message: `Không tìm thấy VĐV với nickname hoặc họ tên "${cleanNick}".`
      });
      continue;
    }

    // Upsert exemption
    await db.weeklyExemption.upsert({
      where: {
        userId_week: {
          userId: user.id,
          week: weekNumber
        }
      },
      update: {
        reason: reason
      },
      create: {
        userId: user.id,
        week: weekNumber,
        reason: reason
      }
    });

    results.push({
      success: true,
      nickname: user.nickName,
      fullName: user.fullName,
      week: weekNumber,
      message: `Đã xác nhận miễn trừ / nghỉ ốm trong Tuần ${weekNumber} (${reason}).`
    });
  }

  return results;
}

/**
 * Revoke weekly exemption (e.g. athlete recovered and continues competing).
 */
export async function revokeWeeklyExemption(
  weekNumber: number,
  nicknames: string[]
): Promise<ExemptionResult[]> {
  const results: ExemptionResult[] = [];

  if (weekNumber < 1 || weekNumber > 4) {
    return [{
      success: false,
      nickname: '',
      message: `Tuần ${weekNumber} không hợp lệ. Vui lòng chọn tuần từ 1 đến 4.`
    }];
  }

  for (const rawNick of nicknames) {
    const cleanNick = rawNick.trim().replace(/^@/, '');
    if (!cleanNick) continue;

    const user = await findUserByFlexibleQuery(cleanNick);
    if (!user) {
      results.push({
        success: false,
        nickname: cleanNick,
        message: `Không tìm thấy VĐV với nickname hoặc họ tên "${cleanNick}".`
      });
      continue;
    }

    const deleted = await db.weeklyExemption.deleteMany({
      where: {
        userId: user.id,
        week: weekNumber
      }
    });

    if (deleted.count === 0) {
      results.push({
        success: false,
        nickname: user.nickName,
        fullName: user.fullName,
        week: weekNumber,
        message: `VĐV chưa từng có trạng thái nghỉ ốm trong Tuần ${weekNumber}.`
      });
    } else {
      results.push({
        success: true,
        nickname: user.nickName,
        fullName: user.fullName,
        week: weekNumber,
        message: `Đã hủy trạng thái nghỉ ốm Tuần ${weekNumber} cho VĐV ${user.fullName || user.nickName}.`
      });
    }
  }

  return results;
}

/**
 * Get Set of exempt user IDs for a given week.
 */
export async function getExemptUserIdsForWeek(weekNumber: number): Promise<Set<string>> {
  if (weekNumber < 1 || weekNumber > 4) return new Set();

  const exemptions = await db.weeklyExemption.findMany({
    where: { week: weekNumber },
    select: { userId: true }
  });

  return new Set(exemptions.map(e => e.userId));
}

/**
 * Get detailed list of athletes with weekly exemptions (optionally filtered by week).
 */
export async function getWeeklyExemptionsList(weekNumber?: number | null) {
  const where: any = {};
  if (weekNumber && weekNumber >= 1 && weekNumber <= 4) {
    where.week = weekNumber;
  }

  return await db.weeklyExemption.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          nickName: true,
          fullName: true,
          teamId: true,
          department: true,
          gender: true
        }
      }
    },
    orderBy: [
      { week: 'asc' },
      { user: { teamId: 'asc' } }
    ]
  });
}
