import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { db } from './config/db';
import { handleStravaLink, handleStravaCallback, handleSyncAll, handleOverrideActivity } from './controllers/auth.controller';
import { verifyWebhook, handleWebhookEvent } from './controllers/webhook.controller';
import { initTelegramBot } from './bot';
import { initWeeklyCronJob } from './cron/weekly';
import { initKeepAliveCronJob } from './cron/keepalive';
import { migrateLegacyUsersAppClientId } from './services/stravapool.service';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend landing page
app.use(express.static(path.join(__dirname, '../public')));

// Auth Routes (Web Onboarding, OAuth, Historical Sync & Admin Override)
app.post('/auth/strava-link', handleStravaLink);
app.get('/auth/callback', handleStravaCallback);
app.post('/auth/sync-all', handleSyncAll);
app.get('/auth/sync-all', handleSyncAll); // Allow triggering sync via GET in Browser
app.post('/auth/override-activity', handleOverrideActivity); // Admin manual approval API

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
app.listen(env.PORT, () => {
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

  // Populate default appClientId for legacy users in DB
  migrateLegacyUsersAppClientId();
});

export default app;
