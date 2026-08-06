import { db } from '../config/db';

export interface PenaltyRecord {
  nickName: string;
  fullName: string | null;
  gender: 'MALE' | 'FEMALE';
  teamId: number;
  totalKmAchieved: number;
  targetKm: number;
  missingKm: number;
  fineAmountVnd: number;
  isExempt: boolean;
}

/**
 * Calculate penalty status for all participants
 */
export async function calculatePenalties(): Promise<PenaltyRecord[]> {
  const users = await db.user.findMany({
    orderBy: { teamId: 'asc' }
  });

  return users.map((user) => {
    const totalKmAchieved = user.totalDistance / 1000;
    const targetKm = user.gender === 'FEMALE' ? 15 : 30;

    // Rounding rule per IRIS Section VIII:
    // Achievement is rounded down to nearest integer km (e.g. 13.2km -> 13km), so missing km = targetKm - floor(totalKm)
    const flooredAchievedKm = Math.floor(totalKmAchieved);
    const missingKm = Math.max(0, targetKm - flooredAchievedKm);
    const fineAmountVnd = user.isExempt ? 0 : missingKm * 100000;

    return {
      nickName: user.nickName,
      fullName: user.fullName,
      gender: user.gender as 'MALE' | 'FEMALE',
      teamId: user.teamId,
      totalKmAchieved,
      targetKm,
      missingKm: user.isExempt ? 0 : missingKm,
      fineAmountVnd,
      isExempt: user.isExempt
    };
  });
}
