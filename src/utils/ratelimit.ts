/**
 * Token Bucket Rate Limiter per Strava Client ID
 * Default limit: 90 reads per 15-minute window (safety margin under Strava 100/15min)
 * Default daily limit: 900 reads per day (safety margin under Strava 1000/day)
 */

export class StravaDailyQuotaError extends Error {
  public clientId: string;

  constructor(clientId: string) {
    super(`[Strava Daily Quota Exceeded] App Client ID ${clientId} reached 90% daily API limit (900/1000).`);
    this.name = 'StravaDailyQuotaError';
    this.clientId = clientId;
  }
}

interface ClientBucket {
  read15mUsage: number;
  read15mLimit: number;
  readDailyUsage: number;
  readDailyLimit: number;
  lastReset15m: number;
  lastResetDaily: number;
}

class StravaRateLimiter {
  private buckets = new Map<string, ClientBucket>();

  private getBucket(clientId: string): ClientBucket {
    const key = clientId || 'default';
    let bucket = this.buckets.get(key);
    const now = Date.now();

    if (!bucket) {
      bucket = {
        read15mUsage: 0,
        read15mLimit: 90,
        readDailyUsage: 0,
        readDailyLimit: 900,
        lastReset15m: now,
        lastResetDaily: now
      };
      this.buckets.set(key, bucket);
    }

    // Time-based auto reset for 15-minute window (15 * 60 * 1000 = 900,000ms)
    if (now - bucket.lastReset15m > 15 * 60 * 1000) {
      bucket.read15mUsage = 0;
      bucket.lastReset15m = now;
    }

    // Time-based auto reset for Daily window (24 * 60 * 60 * 1000 = 86,400,000ms)
    if (now - bucket.lastResetDaily > 24 * 60 * 60 * 1000) {
      bucket.readDailyUsage = 0;
      bucket.lastResetDaily = now;
    }

    return bucket;
  }

  /**
   * Record real usage returned by Strava headers (x-readratelimit-usage / x-readratelimit-limit)
   */
  public updateFromHeaders(clientId: string, usageHeader?: string, limitHeader?: string): void {
    if (!usageHeader || !limitHeader) return;

    try {
      const [u15, uDaily] = String(usageHeader).split(',').map(Number);
      const [l15, lDaily] = String(limitHeader).split(',').map(Number);

      const bucket = this.getBucket(clientId);
      if (!isNaN(u15) && u15 >= 0) bucket.read15mUsage = u15;
      if (!isNaN(uDaily) && uDaily >= 0) bucket.readDailyUsage = uDaily;
      if (!isNaN(l15) && l15 > 0) bucket.read15mLimit = l15;
      if (!isNaN(lDaily) && lDaily > 0) bucket.readDailyLimit = lDaily;
    } catch (e) {
      // Ignore header parse errors
    }
  }

  /**
   * Acquire a slot before making a Strava API read request.
   * Throws StravaDailyQuotaError if daily limit is reached to IMMEDIATELY release worker slots.
   * Delays for up to 15 minutes if 15-minute window limit is reached.
   */
  public async acquire(clientId: string = 'default'): Promise<void> {
    const bucket = this.getBucket(clientId);

    // 1. Check Daily Limit (>= 90% of daily limit) -> THROW ERROR IMMEDIATELY TO FREE PQUEUE SLOT!
    if (bucket.readDailyLimit > 0 && bucket.readDailyUsage >= Math.floor(bucket.readDailyLimit * 0.9)) {
      console.warn(
        `[Strava RateLimiter] Client ${clientId} reached 90% DAILY rate limit (${bucket.readDailyUsage}/${bucket.readDailyLimit}). ` +
        `Throwing StravaDailyQuotaError to release queue worker slot immediately.`
      );
      throw new StravaDailyQuotaError(clientId);
    }

    // 2. Check 15-Minute Limit (>= 90% of 15m limit) -> Pause for up to 15 mins max
    if (bucket.read15mLimit > 0 && bucket.read15mUsage >= Math.floor(bucket.read15mLimit * 0.9)) {
      const now = new Date();
      // Calculate milliseconds until next 15-minute clock boundary (:00, :15, :30, :45)
      const currentMin = now.getMinutes();
      const nextQuarterMin = (Math.floor(currentMin / 15) + 1) * 15;
      const targetTime = new Date(now);
      targetTime.setMinutes(nextQuarterMin, 2, 0); // 2 sec after quarter hour

      const waitMs = Math.max(1000, targetTime.getTime() - now.getTime());
      console.warn(
        `[Strava RateLimiter] Client ${clientId} reached 90% 15-MIN rate limit usage (${bucket.read15mUsage}/${bucket.read15mLimit}). ` +
        `Pausing pipeline for ${(waitMs / 1000).toFixed(1)}s until next 15-min window (${targetTime.toTimeString().slice(0, 8)})...`
      );

      await new Promise(resolve => setTimeout(resolve, waitMs));
      bucket.read15mUsage = 0;
      bucket.lastReset15m = Date.now();
    }

    bucket.read15mUsage++;
    bucket.readDailyUsage++;
  }
}

export const stravaRateLimiter = new StravaRateLimiter();
