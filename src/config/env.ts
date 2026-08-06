import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isTestMode = 
  process.env.ALLOW_TEST_DATE === 'true' || 
  process.env.ALLOW_TEST_DATE === '1' || 
  process.env.ALLOW_TEST_DATE === 'TRUE';

export const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL || '',
  
  // Single Telegram Group ID for BTC
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_GROUP_ID: process.env.TELEGRAM_GROUP_ID || '',
  
  STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
  STRAVA_VERIFY_TOKEN: process.env.STRAVA_VERIFY_TOKEN || 'my_secret_token',
  
  APP_BASE_URL: (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  
  // Allow test activities submitted before official contest start date 03/08/2026
  ALLOW_TEST_DATE: isTestMode
};
