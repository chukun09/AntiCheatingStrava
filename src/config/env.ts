import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isTestMode = 
  process.env.ALLOW_TEST_DATE === 'true' || 
  process.env.ALLOW_TEST_DATE === '1' || 
  process.env.ALLOW_TEST_DATE === 'TRUE';

const databaseUrl = process.env.DATABASE_URL || '';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';

if (!databaseUrl && process.env.NODE_ENV !== 'test') {
  throw new Error('[FATAL] Missing DATABASE_URL environment variable.');
}

if (!telegramBotToken && process.env.NODE_ENV !== 'test') {
  console.warn('[WARN] Missing TELEGRAM_BOT_TOKEN environment variable. Telegram bot functionality will be disabled.');
}

let adminApiToken = process.env.ADMIN_API_TOKEN || '';
if (!adminApiToken) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[FATAL] Missing ADMIN_API_TOKEN environment variable in production mode.');
  }
  adminApiToken = 'iris_admin_secret_2026';
}

export const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: databaseUrl,
  
  // Single Telegram Group ID for BTC
  TELEGRAM_BOT_TOKEN: telegramBotToken,
  TELEGRAM_GROUP_ID: process.env.TELEGRAM_GROUP_ID || '',
  
  STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
  STRAVA_VERIFY_TOKEN: process.env.STRAVA_VERIFY_TOKEN || 'my_secret_token',
  
  // Multi-App Pool support
  STRAVA_APPS_JSON: process.env.STRAVA_APPS_JSON || '',
  
  APP_BASE_URL: (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  
  // Admin Secret Token for protecting sensitive HTTP endpoints
  ADMIN_API_TOKEN: adminApiToken,

  // Allow test activities submitted before official contest start date 03/08/2026
  ALLOW_TEST_DATE: isTestMode
};
