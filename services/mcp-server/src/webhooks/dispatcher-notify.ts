// Environment variables (configured in Cloud Run, not in code):
// DISPATCHER_WEBHOOK_URL - e.g., http://localhost:7749/webhook/task-created
// DISPATCHER_WEBHOOK_SECRET - shared HMAC secret, must match dispatcher config

import crypto from 'node:crypto';

interface DispatcherNotifyPayload {
  taskId: string;
  target: string;
  priority: string;
  title: string;
  timestamp: string;
}

/**
 * Fire-and-forget notification to the Grid Dispatcher.
 * NEVER throws — webhook failure must not block task creation.
 */
export async function notifyDispatcher(payload: DispatcherNotifyPayload): Promise<void> {
  const webhookUrl = process.env.DISPATCHER_WEBHOOK_URL;
  const webhookSecret = process.env.DISPATCHER_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    // Webhook not configured — silent no-op
    return;
  }

  try {
    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CacheBash-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
  } catch {
    // Fire and forget — dispatcher poll will catch it in ≤5 seconds
  }
}
