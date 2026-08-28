import { Request, Response } from 'express';
import { getDailySummaryReport } from '../services/daily-report.service';
import { appCache } from '../utils/cache';

// Lightweight in-memory rate limiting (60 requests / minute / IP)
const ipRequestMap = new Map<string, { count: number; resetAt: number }>();

const isRateLimited = (ip: string, limit = 60, windowMs = 60000): boolean => {
  const now = Date.now();
  const entry = ipRequestMap.get(ip);

  if (!entry || now > entry.resetAt) {
    ipRequestMap.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (entry.count >= limit) {
    return true;
  }

  entry.count++;
  return false;
};

// Periodic cleanup of expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequestMap.entries()) {
    if (now > entry.resetAt) {
      ipRequestMap.delete(ip);
    }
  }
}, 300000);

/**
 * Controller for public dashboard daily summary API
 * GET /api/dashboard/daily
 */
export async function getDashboardDailySummary(req: Request, res: Response): Promise<Response> {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

  // 1. Security: Rate limiting check
  if (isRateLimited(clientIp, 60, 60000)) {
    return res.status(429).json({
      success: false,
      error: 'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau 1 phút.',
      retryAfter: 60
    });
  }

  try {
    // 2. Parse & sanitize query params
    const rawTop = req.query.top ? parseInt(String(req.query.top), 10) : 20;
    const topN = Math.min(Math.max(isNaN(rawTop) ? 20 : rawTop, 1), 50);

    const cacheKey = `dashboard:daily:top:${topN}`;
    const cacheTtlMs = 5000; // 5 seconds TTL cache

    // 3. Retrieve from memory cache with single-flight mutex
    const { data, isCached, ageMs } = await appCache.getOrSet(
      cacheKey,
      () => getDailySummaryReport({ topN }),
      cacheTtlMs
    );

    // 4. Set security and cache response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Cache', isCached ? 'HIT' : 'MISS');
    res.setHeader('X-Cache-Age', `${ageMs}ms`);
    res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=5');

    return res.status(200).json({
      success: true,
      cached: isCached,
      ageMs,
      data
    });
  } catch (error: any) {
    console.error('[Dashboard API] Error fetching daily summary:', error);
    return res.status(500).json({
      success: false,
      error: 'Không thể tải dữ liệu bảng tổng hợp. Vui lòng thử lại sau.'
    });
  }
}
