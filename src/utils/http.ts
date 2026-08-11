import axios from 'axios';

/**
 * Shared HTTP Client for Strava API requests with 15-second timeout
 * Prevents socket hanging from locking worker threads.
 */
export const stravaHttp = axios.create({
  timeout: 15000,
  headers: {
    'Accept': 'application/json'
  }
});

/**
 * Shared HTTP Client for Telegram API requests with 15-second timeout
 */
export const telegramHttp = axios.create({
  timeout: 15000
});
