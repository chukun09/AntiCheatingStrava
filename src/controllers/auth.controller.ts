import { Request, Response } from 'express';
import axios from 'axios';
import { db } from '../config/db';
import { env } from '../config/env';
import { getTeamName } from '../services/team.service';
import { syncUserPastActivities, syncAllUsersPastActivities } from '../services/sync.service';
import { overrideActivityStatus } from '../services/override.service';
import { getAvailableStravaApp, getAppCredentials, decrementPendingApp, MAX_USERS_PER_APP } from '../services/stravapool.service';

/**
 * POST /auth/strava-link
 * Form Submit from Web Landing Page: Receives nickName, fullName, gender, department, teamId
 */
export async function handleStravaLink(req: Request, res: Response) {
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cổng Đăng Ký Đã Khép Lại - IRIS Running</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
        <div class="w-16 h-16 bg-orange-500/10 text-[#FC4C02] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-orange-500/20">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
        </div>
        <h2 class="text-xl font-extrabold text-white mb-2">Cổng Đăng Ký Đã Khép Lại</h2>
        <p class="text-slate-400 text-sm mb-6 leading-relaxed">
          Giải chạy IRIS 2026 đã chốt đủ danh sách VĐV tham gia. Vui lòng theo dõi tiến độ và thành tích tại Bảng Xếp Hạng Dashboard.
        </p>
        <a href="/dashboard" class="inline-block w-full py-3 px-5 bg-[#FC4C02] hover:bg-[#e34402] text-white rounded-xl text-sm font-bold transition shadow-lg shadow-orange-600/30">
          Truy Cập Bảng Xếp Hạng
        </a>
      </div>
    </body>
    </html>
  `);
}

/**
 * GET /auth/callback
 * Strava Redirect Callback: Redirects directly to Dashboard as onboarding is closed
 */
export async function handleStravaCallback(req: Request, res: Response) {
  return res.redirect('/dashboard');
}

/**
 * POST /auth/sync-all
 * Endpoint to sync past activities from 03/08/2026 for ALL onboarded users
 */
export async function handleSyncAll(req: Request, res: Response) {
  try {
    // Trigger background sync task
    syncAllUsersPastActivities().catch(err => {
      console.error('[Auth Controller] Background sync error:', err);
    });

    return res.status(202).json({
      status: 'accepted',
      message: 'Đã nhận yêu cầu. Tiến trình đồng bộ dữ liệu toàn bộ VĐV đang được thực thi trong nền (background).'
    });
  } catch (error: any) {
    console.error('[Auth Controller] Error in handleSyncAll:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /auth/override-activity
 * Admin API to manually approve or reject an activity and recalculate stats
 */
export async function handleOverrideActivity(req: Request, res: Response) {
  try {
    const { stravaActivityId, isLegit, reason } = req.body;
    if (!stravaActivityId) {
      return res.status(400).json({ error: 'stravaActivityId is required' });
    }

    const result = await overrideActivityStatus(stravaActivityId, isLegit === true || isLegit === 'true', reason);
    return res.status(200).json({
      status: 'success',
      message: `Đã cập nhật trạng thái bài chạy ${stravaActivityId} thành ${result.isLegit ? 'HỢP LỆ' : 'KHÔNG HỢP LỆ'}.`,
      result
    });
  } catch (error: any) {
    console.error('[Auth Controller] Error in handleOverrideActivity:', error);
    return res.status(500).json({ error: error.message });
  }
}
