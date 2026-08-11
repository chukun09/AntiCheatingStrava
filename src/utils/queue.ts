import PQueue from 'p-queue';

// Concurrency = 2 to stay safe with Strava API rate limits & database writes
export const activityQueue = new PQueue({ concurrency: 2 });

const processedTaskKeys = new Set<string>();

/**
 * Check if specific task (aspectType + activityId) is already in processing queue
 */
export function isActivityQueued(activityId: string, aspectType: string = 'create'): boolean {
  const key = `${aspectType}:${activityId}`;
  return processedTaskKeys.has(key);
}

/**
 * Mark specific task (aspectType + activityId) as queued
 */
export function markActivityQueued(activityId: string, aspectType: string = 'create'): void {
  const key = `${aspectType}:${activityId}`;
  processedTaskKeys.add(key);

  // Safety fallback cleanup cache after 5 minutes
  setTimeout(() => {
    processedTaskKeys.delete(key);
  }, 5 * 60 * 1000);
}

/**
 * Unmark task from processing queue once finished
 */
export function unmarkActivityQueued(activityId: string, aspectType: string = 'create'): void {
  const key = `${aspectType}:${activityId}`;
  processedTaskKeys.delete(key);
}
