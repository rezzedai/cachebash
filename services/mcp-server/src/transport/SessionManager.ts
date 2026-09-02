import { getFirestore } from "../firebase/client.js";
import { SessionInfo, SessionValidation } from "./types.js";
import { randomBytes } from "crypto";

const DEFAULT_SESSION_TIMEOUT = 60 * 60 * 1000; // 60 minutes

// Firestore hard-caps a write batch at 500 operations. 400 leaves headroom and
// keeps each commit comfortably inside the transaction size limit.
const CLEANUP_PAGE_SIZE = 400;

function generateSessionId(): string {
  return randomBytes(16).toString("hex");
}

export class SessionManager {
  private sessionTimeout: number;

  constructor(sessionTimeout: number = DEFAULT_SESSION_TIMEOUT) {
    this.sessionTimeout = sessionTimeout;
  }

  async createSession(
    userId: string,
    authContext?: { userId: string; encryptionKey?: Buffer }
  ): Promise<SessionInfo> {
    const sessionId = generateSessionId();
    const now = Date.now();
    const session: SessionInfo = { sessionId, userId, authContext, lastActivity: now, createdAt: now };

    const db = getFirestore();
    await db.doc(`tenants/${userId}/mcp_sessions/${sessionId}`).set({
      sessionId, userId, lastActivity: now, createdAt: now,
    });

    return session;
  }

  async validateSession(sessionId: string, userId: string): Promise<SessionValidation> {
    const db = getFirestore();
    const doc = await db.doc(`tenants/${userId}/mcp_sessions/${sessionId}`).get();

    if (!doc.exists) return { valid: false, error: "Session not found" };

    const data = doc.data()!;
    const age = Date.now() - data.lastActivity;

    if (age > this.sessionTimeout) {
      await db.doc(`tenants/${userId}/mcp_sessions/${sessionId}`).delete();
      return { valid: false, error: "Session expired" };
    }

    await db.doc(`tenants/${userId}/mcp_sessions/${sessionId}`).update({ lastActivity: Date.now() });

    return {
      valid: true,
      session: {
        sessionId: data.sessionId,
        userId: data.userId,
        lastActivity: data.lastActivity,
        protocolVersion: data.protocolVersion,
        createdAt: data.createdAt,
      },
    };
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const db = getFirestore();
    await db.doc(`tenants/${userId}/mcp_sessions/${sessionId}`).delete();
  }

  async cleanupExpiredSessions(userId: string): Promise<{ expired: number; cleaned: number }> {
    const db = getFirestore();
    const threshold = Date.now() - this.sessionTimeout;

    // Both the read and the write are bounded. The previous implementation
    // fetched EVERY expired session and deleted them in one batch, which works
    // right up until it doesn't: Firestore caps a batch at 500 writes, so once
    // enough expiries accumulate the reaper fails with
    //   3 INVALID_ARGUMENT: Transaction too big
    // and — because it fails wholesale rather than partially — deletes nothing,
    // so the backlog it chokes on only grows. Observed in production
    // 2026-08-12 after this job had been dead ~2 months on an unrelated auth
    // fault: the outage produced a backlog large enough to keep the reaper
    // broken after the auth fault was fixed.
    //
    // Deleting in bounded pages is also naturally resumable: a run that is cut
    // short still makes progress, and the next run continues from the front of
    // the query.
    let expired = 0;
    let cleaned = 0;

    for (;;) {
      const snapshot = await db
        .collection(`tenants/${userId}/mcp_sessions`)
        .where("lastActivity", "<", threshold)
        .limit(CLEANUP_PAGE_SIZE)
        .get();

      if (snapshot.empty) break;

      expired += snapshot.size;

      // Note: Firestore TTL policy on expiresAt field is an alternative for session cleanup
      // (zero code, auto-deletes expired docs), but scheduled job is preferred for relay
      // (preserves dead letter analytics).
      const batch = db.batch();
      snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
      await batch.commit();
      cleaned += snapshot.size;

      // A short page means the query is drained; anything else would re-query
      // an empty collection one extra time for no reason.
      if (snapshot.size < CLEANUP_PAGE_SIZE) break;
    }

    return { expired, cleaned };
  }
}
