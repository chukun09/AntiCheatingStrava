import { Request, Response } from 'express';
import axios from 'axios';
import { db } from '../config/db';
import { env } from '../config/env';
import { getTeamName } from '../services/team.service';
import { syncUserPastActivities, syncAllUsersPastActivities } from '../services/sync.service';
import { overrideActivityStatus } from '../services/override.service';

/**
 * POST /auth/strava-link
 * Form Submit from Web Landing Page: Receives nickName, fullName, gender, department, teamId
 */
export async function handleStravaLink(req: Request, res: Response) {
  try {
    const { nickName, fullName, gender, department, teamId } = req.body;

    if (!nickName || typeof nickName !== 'string' || !nickName.trim()) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
          <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
            <h2 class="text-xl font-bold text-red-500 mb-4">Vui lòng nhập Nickname định danh!</h2>
            <a href="/" class="inline-block py-2.5 px-5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-medium">Quay lại trang đăng ký</a>
          </div>
        </body>
        </html>
      `);
    }

    const trimmedNickName = nickName.trim();
    const userGender = gender === 'FEMALE' ? 'FEMALE' : 'MALE';
    const userTeamId = parseInt(teamId || '1', 10);

    const statePayload = JSON.stringify({
      nickName: trimmedNickName,
      fullName: fullName ? fullName.trim() : null,
      gender: userGender,
      department: department ? department.trim() : null,
      teamId: userTeamId
    });

    const stateEncoded = Buffer.from(statePayload).toString('base64');
    const redirectUri = `${env.APP_BASE_URL}/auth/callback`;

    const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=read,activity:read_all&state=${encodeURIComponent(stateEncoded)}`;

    return res.redirect(stravaAuthUrl);
  } catch (error: any) {
    console.error('[Auth Controller] Error in handleStravaLink:', error);
    return res.status(500).send('Lỗi hệ thống khi khởi tạo Strava OAuth');
  }
}

/**
 * GET /auth/callback
 * Strava Redirect Callback: Exchanges code for tokens, upserts User, AND syncs historical activities
 */
export async function handleStravaCallback(req: Request, res: Response) {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
          <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
            <h2 class="text-xl font-bold text-red-500 mb-2">Kết nối Strava không thành công!</h2>
            <p class="text-slate-400 text-sm mb-4">Lỗi: ${error || 'Không nhận được mã xác thực (code) từ Strava'}</p>
            <a href="/" class="inline-block py-2.5 px-5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-medium">Thử lại</a>
          </div>
        </body>
        </html>
      `);
    }

    // Decode state
    let stateData: { nickName: string; fullName?: string | null; gender?: 'MALE' | 'FEMALE'; department?: string | null; teamId?: number } = { nickName: 'Runner', gender: 'MALE', teamId: 1 };
    if (state && typeof state === 'string') {
      try {
        const decodedStr = Buffer.from(state, 'base64').toString('utf-8');
        stateData = JSON.parse(decodedStr);
      } catch (e) {
        console.warn('[Auth Callback] Failed to parse state payload:', e);
      }
    }

    // Exchange authorization code for access_token and refresh_token
    const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code: String(code),
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_at, athlete } = tokenResponse.data;
    const stravaAthleteId = BigInt(athlete.id);
    const tokenExpiresAt = new Date(expires_at * 1000);

    const userGender = stateData.gender === 'FEMALE' ? 'FEMALE' : 'MALE';
    const userTeamId = stateData.teamId || 1;

    // Check if athlete or nickname already exists
    const existingUserByAthlete = await db.user.findUnique({
      where: { stravaAthleteId }
    });

    const existingUserByNickName = await db.user.findUnique({
      where: { nickName: stateData.nickName }
    });

    // Check for nickname conflict
    if (existingUserByNickName && existingUserByNickName.stravaAthleteId !== null && existingUserByNickName.stravaAthleteId !== stravaAthleteId) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
          <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
            <h2 class="text-xl font-bold text-amber-500 mb-2">Nickname đã được đăng ký!</h2>
            <p class="text-slate-300 text-sm mb-6">Nickname <b>"${stateData.nickName}"</b> đã thuộc về một tài khoản Strava khác. Vui lòng quay lại và chọn Nickname khác.</p>
            <a href="/" class="inline-block py-2.5 px-5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-medium">Quay về trang đăng ký</a>
          </div>
        </body>
        </html>
      `);
    }

    let savedUser;

    if (existingUserByAthlete) {
      // Update existing athlete record
      savedUser = await db.user.update({
        where: { id: existingUserByAthlete.id },
        data: {
          nickName: stateData.nickName,
          fullName: stateData.fullName || existingUserByAthlete.fullName,
          gender: userGender,
          department: stateData.department || existingUserByAthlete.department,
          teamId: userTeamId,
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: tokenExpiresAt
        }
      });
    } else if (existingUserByNickName) {
      // Update existing nickname record with new athlete ID & tokens
      savedUser = await db.user.update({
        where: { id: existingUserByNickName.id },
        data: {
          stravaAthleteId: stravaAthleteId,
          fullName: stateData.fullName || existingUserByNickName.fullName,
          gender: userGender,
          department: stateData.department || existingUserByNickName.department,
          teamId: userTeamId,
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: tokenExpiresAt
        }
      });
    } else {
      // Create brand new User
      savedUser = await db.user.create({
        data: {
          nickName: stateData.nickName,
          fullName: stateData.fullName || null,
          gender: userGender,
          department: stateData.department || null,
          teamId: userTeamId,
          stravaAthleteId: stravaAthleteId,
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: tokenExpiresAt
        }
      });
    }

    const teamName = getTeamName(savedUser.teamId);
    console.log(`[Auth Callback] User successfully onboarded: Nickname=${savedUser.nickName}, Gender=${savedUser.gender}, Team=${teamName}`);

    // AUTOMATICALLY SYNC ALL PAST ACTIVITIES FROM 03/08/2026 FOR THIS USER
    syncUserPastActivities(savedUser.id).catch(err => {
      console.error(`[Auth Callback] Error in background historical sync for user ${savedUser.nickName}:`, err);
    });

    // Return HTML success screen
    return res.send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kết nối thành công - Hành Trình IRIS</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          <div class="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          
          <h1 class="text-2xl font-bold text-white mb-2">ĐĂNG KÝ HÀNH TRÌNH IRIS THÀNH CÔNG!</h1>
          <p class="text-slate-400 mb-6">Tài khoản Strava của bạn đã được kết nối. Các bài chạy từ 03/08/2026 đến nay đang được tự động đồng bộ!</p>
          
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 mb-6 text-left space-y-2.5">
            <div class="flex justify-between text-sm">
              <span class="text-slate-400">Nickname:</span>
              <span class="font-semibold text-emerald-400">${savedUser.nickName}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-slate-400">Giới tính:</span>
              <span class="font-medium text-white">${savedUser.gender === 'FEMALE' ? 'Nữ 👩 (Chỉ tiêu 15km)' : 'Nam 👨 (Chỉ tiêu 30km)'}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-slate-400">Đội thi đấu:</span>
              <span class="font-semibold text-amber-400">${teamName}</span>
            </div>
          </div>

          <a href="/" class="inline-block w-full py-3 px-4 bg-orange-600 hover:bg-orange-500 text-white font-medium rounded-xl transition duration-200">
            Quay về trang chủ
          </a>
        </div>
      </body>
      </html>
    `);
  } catch (error: any) {
    console.error('[Auth Controller] Error in handleStravaCallback:', error?.response?.data || error.message);
    return res.status(500).send('Lỗi khi xác thực với Strava API');
  }
}

/**
 * POST /auth/sync-all
 * Endpoint to sync past activities from 03/08/2026 for ALL onboarded users
 */
export async function handleSyncAll(req: Request, res: Response) {
  try {
    const result = await syncAllUsersPastActivities();
    return res.status(200).json({
      status: 'success',
      message: `Đã hoàn thành đồng bộ dữ liệu quá khứ cho ${result.totalUsers} vận động viên.`,
      result
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
