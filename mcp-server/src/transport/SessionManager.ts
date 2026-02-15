import { getFirestore } from "../firebase/client.js";
import { SessionInfo, SessionValidation } from "./types.js";
import { randomBytes } from "crypto";

const DEFAULT_SESSION_TIMEOUT = 60 * 60 * 1000; // 60 minutes

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
    await db.doc(`users/${userId}/mcp_sessions/${sessionId}`).set({
      sessionId, userId, lastActivity: now, createdAt: now,
    });

    return session;
  }

  async validateSession(sessionId: string, userId: string): Promise<SessionValidation> {
    const db = getFirestore();
    const doc = await db.doc(`users/${userId}/mcp_sessions/${sessionId}`).get();

    if (!doc.exists) return { valid: false, error: "Session not found" };

    const data = doc.data()!;
    const age = Date.now() - data.lastActivity;

    if (age > this.sessionTimeout) {
      await db.doc(`users/${userId}/mcp_sessions/${sessionId}`).delete();
      return { valid: false, error: "Session expired" };
    }

    await db.doc(`users/${userId}/mcp_sessions/${sessionId}`).update({ lastActivity: Date.now() });

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
    await db.doc(`users/${userId}/mcp_sessions/${sessionId}`).delete();
  }

  async cleanupExpiredSessions(userId: string): Promise<number> {
    const db = getFirestore();
    const threshold = Date.now() - this.sessionTimeout;
    const snapshot = await db
      .collection(`users/${userId}/mcp_sessions`)
      .where("lastActivity", "<", threshold)
      .get();

    if (snapshot.empty) return 0;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return snapshot.size;
  }
}
