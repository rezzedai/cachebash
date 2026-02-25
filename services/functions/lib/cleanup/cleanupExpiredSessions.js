"use strict";
/**
 * Cleanup expired sessions.
 * Runs every 5 minutes. Transitions sessions without heartbeat for 65+ minutes to derezzed.
 * Emits relay message to ISO for each reaped session.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredSessions = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const SESSION_TIMEOUT_MS = 65 * 60 * 1000; // 65 min
exports.cleanupExpiredSessions = functions.pubsub
    .schedule("every 5 minutes")
    .onRun(async () => {
    const db = admin.firestore();
    const staleThreshold = admin.firestore.Timestamp.fromMillis(Date.now() - SESSION_TIMEOUT_MS);
    functions.logger.info(`[cleanupExpiredSessions] Looking for active/created sessions with lastHeartbeat < ${staleThreshold.toDate().toISOString()}`);
    try {
        // Collection group query across all users' sessions
        // Only target active and created sessions
        const expiredSnapshot = await db
            .collectionGroup("sessions")
            .where("status", "in", ["active", "created"])
            .where("lastHeartbeat", "<", staleThreshold)
            .limit(250) // Limit for batch safety (2 writes per session: update + relay)
            .get();
        if (expiredSnapshot.empty) {
            functions.logger.info("[cleanupExpiredSessions] No expired sessions found");
            return { reaped: 0 };
        }
        const batch = db.batch();
        const reapedSessions = [];
        const now = Date.now();
        for (const doc of expiredSnapshot.docs) {
            const data = doc.data();
            const sessionId = doc.id;
            const programId = data.programId || "unknown";
            const userId = doc.ref.parent.parent.id;
            // Calculate time since last heartbeat
            const lastHeartbeatMs = data.lastHeartbeat?.toMillis() || 0;
            const minutesSinceHeartbeat = Math.round((now - lastHeartbeatMs) / 60000);
            // Update session to derezzed
            batch.update(doc.ref, {
                status: "derezzed",
                archived: true,
                archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                endedAt: admin.firestore.FieldValue.serverTimestamp(),
                reapReason: "heartbeat_timeout",
                lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Emit relay message to ISO
            const relayRef = db.collection("users").doc(userId).collection("relay").doc();
            batch.set(relayRef, {
                source: "system",
                target: "iso",
                message_type: "STATUS",
                message: `Session ${sessionId} (${programId}) reaped — no heartbeat for ${minutesSinceHeartbeat} minutes`,
                priority: "normal",
                action: "queue",
                status: "created",
                read: false,
                ttl: 86400,
                expiresAt: new Date(now + 86400000),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            reapedSessions.push(`${sessionId} (${programId})`);
        }
        await batch.commit();
        functions.logger.info(`[cleanupExpiredSessions] Reaped ${reapedSessions.length} sessions:`, reapedSessions);
        return { reaped: reapedSessions.length };
    }
    catch (error) {
        functions.logger.error("[cleanupExpiredSessions] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=cleanupExpiredSessions.js.map