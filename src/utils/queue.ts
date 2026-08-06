import PQueue from 'p-queue';

// Concurrency = 2 to stay safe with Strava API rate limits & database writes
export const activityQueue = new PQueue({ concurrency: 2 });

const processedActivityIds = new Set<string>();

/**
 * Check if activity is already in processing queue
 */
export function isActivityQueued(activityId: string): boolean {
  const key = String(activityId);
  return processedActivityIds.has(key);
}

/**
 * Mark activity as queued
 */
export function markActivityQueued(activityId: string): void {
  const key = String(activityId);
  processedActivityIds.add(key);
  
  // Clean up cache after 10 minutes to prevent memory leak
  setTimeout(() => {
    processedActivityIds.delete(key);
  }, 10 * 60 * 1000);
}
