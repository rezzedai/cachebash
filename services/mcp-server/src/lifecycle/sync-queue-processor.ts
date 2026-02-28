import { getFirestore, serverTimestamp } from "../firebase/client.js";
import { emitEvent } from "../modules/events.js";
import { retrySyncOperation } from "../modules/github-sync.js";

type SyncQueueDoc = {
  operation?: string;
  payload?: Record<string, any>;
  attempts?: number;
  retryCount?: number;
};

export async function processSyncQueue(userId: string): Promise<void> {
  const db = getFirestore();
  const queue = db.collection(`tenants/${userId}/sync_queue`);

  let snapshot: FirebaseFirestore.QuerySnapshot;
  try {
    snapshot = await queue.orderBy("createdAt").limit(20).get();
  } catch {
    snapshot = await queue.orderBy("timestamp").limit(20).get();
  }

  for (const doc of snapshot.docs) {
    try {
      const data = doc.data() as SyncQueueDoc;
      const operation = data.operation;
      const payload = data.payload || {};
      const attempts = data.attempts ?? data.retryCount ?? 0;

      if (!operation) {
        await doc.ref.delete();
        continue;
      }

      if (attempts >= 3) {
        await doc.ref.update({
          exhausted: true,
          status: "exhausted",
          attempts,
          retryCount: attempts,
          lastAttemptAt: serverTimestamp(),
        });
        emitEvent(userId, {
          event_type: "GITHUB_SYNC_RETRY_EXHAUSTED",
          program_id: "system",
          operation,
          attempts,
        });
        continue;
      }

      try {
        await retrySyncOperation(userId, operation, payload);
        await doc.ref.delete();
      } catch (err) {
        const nextAttempts = attempts + 1;
        await doc.ref.update({
          attempts: nextAttempts,
          retryCount: nextAttempts,
          lastAttemptAt: serverTimestamp(),
          lastError: err instanceof Error ? err.message : String(err),
          status: "pending",
        });
        emitEvent(userId, {
          event_type: "GITHUB_SYNC_RETRY",
          program_id: "system",
          operation,
          attempts: nextAttempts,
        });
      }
    } catch (err) {
      console.error("[SyncQueue] Failed processing queue item:", err);
    }
  }
}
