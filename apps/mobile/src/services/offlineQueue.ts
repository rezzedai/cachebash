import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const QUEUE_KEY = 'offline_message_queue';

export interface QueuedMessage {
  id: string;
  source: string;
  target: string;
  message: string;
  message_type: string;
  priority: string;
  queuedAt: string;
}

async function getQueue(): Promise<QueuedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedMessage[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueMessage(msg: Omit<QueuedMessage, 'id' | 'queuedAt'>): Promise<QueuedMessage> {
  const queued: QueuedMessage = {
    ...msg,
    id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
  };
  const queue = await getQueue();
  queue.push(queued);
  await saveQueue(queue);
  return queued;
}

export async function getQueuedMessages(): Promise<QueuedMessage[]> {
  return getQueue();
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  await saveQueue(queue.filter(m => m.id !== id));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/**
 * Drain the offline queue — send all queued messages via the API.
 * Returns the number of successfully sent messages.
 */
export async function drainQueue(
  sendFn: (msg: { source: string; target: string; message: string; message_type: string; priority: string }) => Promise<unknown>
): Promise<number> {
  const queue = await getQueue();
  if (queue.length === 0) return 0;

  let sent = 0;
  const remaining: QueuedMessage[] = [];

  for (const msg of queue) {
    try {
      await sendFn({
        source: msg.source,
        target: msg.target,
        message: msg.message,
        message_type: msg.message_type,
        priority: msg.priority,
      });
      sent++;
    } catch {
      remaining.push(msg);
    }
  }

  await saveQueue(remaining);
  return sent;
}
