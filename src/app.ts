import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { db } from './config/db';
import { handleStravaLink, handleStravaCallback, handleSyncAll, handleOverrideActivity } from './controllers/auth.controller';
import { verifyWebhook, handleWebhookEvent } from './controllers/webhook.controller';
import { getDashboardDailySummary } from './controllers/dashboard.controller';
import { initTelegramBot } from './bot';
import { initWeeklyCronJob } from './cron/weekly';
import { initKeepAliveCronJob } from './cron/keepalive';
import { initReconcileCronJob } from './cron/reconcile';
import { migrateLegacyUsersAppClientId } from './services/stravapool.service';
import { activityQueue } from './utils/queue';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend landing page
app.use(express.static(path.join(__dirname, '../public')));

// Public Dashboard Route & API
app.get('/api/dashboard/daily', getDashboardDailySummary);
app.get(['/dashboard', '/bxh', '/bang-xep-hang'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Admin Token Middleware to protect sensitive administrative HTTP endpoints
const adminAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!token || token !== env.ADMIN_API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-admin-token header.' });
  }
  next();
};

// Auth Routes (Web Onboarding, OAuth, Historical Sync & Admin Override)
app.post('/auth/strava-link', handleStravaLink);
app.get('/auth/callback', handleStravaCallback);
app.post('/auth/sync-all', adminAuthMiddleware, handleSyncAll);
app.post('/auth/override-activity', adminAuthMiddleware, handleOverrideActivity); // Admin manual approval API

// Webhook Routes (Strava Event Listener)
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhookEvent);

// System & Database Healthcheck Endpoint
// Pings Supabase PostgreSQL with SELECT 1 (unsafe raw) to keep BOTH Render and Database active 24/7
app.get('/health', async (req, res) => {
  try {
    // Perform a lightweight unsafe SQL ping (bypasses prepared statement cache)
    await db.$queryRawUnsafe('SELECT 1');
    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error: any) {
    console.error('[Healthcheck] DB Ping Error:', error?.message || error);
    return res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: error?.message || 'DB Ping Failed'
    });
  }
});

// Start Server
const server = app.listen(env.PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 IRIS Running System online on port ${env.PORT}`);
  console.log(`🔗 Public App Base URL: ${env.APP_BASE_URL}`);
  console.log(`📍 Web Landing Page: ${env.APP_BASE_URL}/`);
  console.log(`📍 Strava Webhook URL: ${env.APP_BASE_URL}/webhook`);
  console.log(`====================================================`);

  // Initialize Telegram Bot
  initTelegramBot();

  // Initialize Weekly Sunday CronJob
  initWeeklyCronJob();

  // Initialize Self-Ping Keep-Alive CronJob (Every 5 minutes)
  initKeepAliveCronJob();

  // Initialize Daily 03:00 AM Reconcile Audit CronJob
  initReconcileCronJob();

  // Populate default appClientId for legacy users in DB
  migrateLegacyUsersAppClientId();
});

// Graceful Shutdown Handler
const gracefulShutdown = (signal: string) => {
  console.log(`[System] ${signal} signal received. Starting graceful shutdown...`);

  server.close(async () => {
    console.log('[System] HTTP server closed.');

    try {
      // Drain processing queue (timeout 10s max)
      console.log('[System] Waiting for activity queue to drain...');
      await Promise.race([
        activityQueue.onIdle(),
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
    } catch (err: any) {
      console.warn('[System] Queue drain error:', err?.message);
    }

    try {
      console.log('[System] Disconnecting database...');
      await db.$disconnect();
      console.log('[System] Database disconnected.');
    } catch (err: any) {
      console.error('[System] DB disconnect error:', err?.message);
    }

    console.log('[System] Graceful shutdown complete. Exiting process.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
