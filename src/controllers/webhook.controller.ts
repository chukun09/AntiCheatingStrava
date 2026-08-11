import { Request, Response } from 'express';
import { env } from '../config/env';
import { activityQueue, isActivityQueued, markActivityQueued, unmarkActivityQueued } from '../utils/queue';
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
 * Helper function to enqueue activity task into P-Queue with pending aspect coalescing
 */
function enqueueActivityTask(activityId: string, athleteId: string | bigint | number, aspectType: 'create' | 'update' | 'delete') {
  markActivityQueued(activityId, aspectType);
  
  activityQueue.add(async () => {
    try {
      await processActivityQueueItem(activityId, String(athleteId), aspectType);
    } finally {
      // Check if another event for the same activity arrived while running
      const pendingAspect = unmarkActivityQueued(activityId);
      if (pendingAspect) {
        console.log(`[Queue Worker] Executing coalesced pending aspect for activity ${activityId}: ${pendingAspect}`);
        enqueueActivityTask(activityId, athleteId, pendingAspect);
      }
    }
  }).catch((err) => {
    console.error(`[Queue Error] Error executing activity task ${activityId} (${aspectType}):`, err);
    unmarkActivityQueued(activityId);
  });
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
      const activityId = String(event.object_id);
      const athleteId = event.owner_id;
      const aspectType = event.aspect_type as 'create' | 'update' | 'delete';

      if (activityId && athleteId) {
        // Queue length cap guard (max 500 items) to prevent OOM on 512MB RAM
        if (activityQueue.size > 500) {
          console.warn(`[Webhook Event] Activity queue size limit reached (${activityQueue.size} items). Dropping non-critical webhook event for activity ${activityId}.`);
          return res.status(200).json({ status: 'queue_full_dropped' });
        }

        if (isActivityQueued(activityId, aspectType)) {
          console.log(`[Webhook Event] Activity ${activityId} (${aspectType}) is already in processing queue. Coalesced into pending tasks.`);
        } else {
          enqueueActivityTask(activityId, athleteId, aspectType);
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
