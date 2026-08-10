import { Request, Response } from 'express';
import { env } from '../config/env';
import { activityQueue, isActivityQueued, markActivityQueued } from '../utils/queue';
import { processActivityQueueItem } from '../services/activity.service';

/**
 * GET /webhook
 * Strava Webhook Verification Handshake
 */
export async function verifyWebhook(req: Request, res: Response) {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[Webhook Verification] Received challenge request:', { mode, token, challenge });

    if (mode === 'subscribe' && token === env.STRAVA_VERIFY_TOKEN) {
      console.log('[Webhook Verification] Handshake successful!');
      return res.status(200).json({ 'hub.challenge': challenge });
    }

    console.warn('[Webhook Verification] Invalid verify token or mode.');
    return res.status(403).json({ error: 'Forbidden: Invalid verify token' });
  } catch (error: any) {
    console.error('[Webhook Verification] Error in verifyWebhook:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * POST /webhook
 * Strava Event Listener: Accepts webhook event and dispatches task to P-Queue
 */
export async function handleWebhookEvent(req: Request, res: Response) {
  try {
    const event = req.body;
    console.log('[Webhook Event] Received Strava event:', event);

    // Process 'activity' creation, update, AND delete events
    if (event.object_type === 'activity' && (event.aspect_type === 'create' || event.aspect_type === 'update' || event.aspect_type === 'delete')) {
      const activityId = event.object_id;
      const athleteId = event.owner_id;
      const aspectType = event.aspect_type as 'create' | 'update' | 'delete';

      if (activityId && athleteId) {
        if (isActivityQueued(String(activityId))) {
          console.log(`[Webhook Event] Activity ${activityId} is already in processing queue. Skipping duplicate.`);
        } else {
          markActivityQueued(String(activityId));
          
          // Push task into P-Queue asynchronously
          activityQueue.add(() => processActivityQueueItem(activityId, athleteId, aspectType)).catch((err) => {
            console.error(`[Queue Error] Error executing activity task ${activityId}:`, err);
          });

          console.log(`[Webhook Event] Activity ${activityId} queued successfully (aspect_type=${aspectType}). Current queue length: ${activityQueue.size}`);
        }
      }
    }

    // ALWAYS return 200 OK immediately to Strava within 2 seconds
    return res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error('[Webhook Event] Error in handleWebhookEvent:', error);
    return res.status(200).json({ status: 'error_handled' });
  }
}
