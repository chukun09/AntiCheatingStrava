import PQueue from 'p-queue';

// Concurrency = 2, intervalCap = 60 per 15 minutes to stay completely safe under Strava API limits
export const activityQueue = new PQueue({
  concurrency: 2,
  intervalCap: 60,
  interval: 15 * 60 * 1000
});

const processedTaskKeys = new Set<string>();
const pendingAspectsMap = new Map<string, 'create' | 'update' | 'delete'>();

type AspectType = 'create' | 'update' | 'delete';

// Helper to determine priority: delete (3) > update (2) > create (1)
function getAspectPriority(aspect: AspectType): number {
  if (aspect === 'delete') return 3;
  if (aspect === 'update') return 2;
  return 1;
}

/**
 * Check if specific activityId is already being processed or queued.
 * If already processing, stores/upgrades incoming aspect in pendingAspectsMap so updates/deletes are not lost!
 */
export function isActivityQueued(activityId: string, aspectType: AspectType = 'create'): boolean {
  const idStr = String(activityId);
  if (processedTaskKeys.has(idStr)) {
    // Coalesce pending aspect: upgrade to higher priority if new aspect has higher priority
    const currentPending = pendingAspectsMap.get(idStr);
    if (!currentPending || getAspectPriority(aspectType) > getAspectPriority(currentPending)) {
      pendingAspectsMap.set(idStr, aspectType);
      console.log(`[Queue Coalescing] Coalesced pending aspect for activity ${idStr} -> ${aspectType}`);
    }
    return true;
  }
  return false;
}

/**
 * Mark specific activityId as queued
 */
export function markActivityQueued(activityId: string, _aspectType: AspectType = 'create'): void {
  const idStr = String(activityId);
  processedTaskKeys.add(idStr);
}

/**
 * Unmark task from processing queue once finished.
 * Returns pending aspect if any coalesced event arrived while task was running!
 */
export function unmarkActivityQueued(activityId: string): AspectType | null {
  const idStr = String(activityId);
  processedTaskKeys.delete(idStr);

  if (pendingAspectsMap.has(idStr)) {
    const pendingAspect = pendingAspectsMap.get(idStr)!;
    pendingAspectsMap.delete(idStr);
    return pendingAspect;
  }

  return null;
}
