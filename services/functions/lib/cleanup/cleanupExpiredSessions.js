"use strict";
/**
 * Cleanup expired sessions.
 * Runs every 5 minutes. Transitions sessions without heartbeat for 65+ minutes to archived.
 * Emits relay message to the orchestrator for each reaped session.
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
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const SESSION_TIMEOUT_MS = 65 * 60 * 1000; // 65 min
exports.cleanupExpiredSessions = functions.pubsub
    .schedule("every 5 minutes")
    .onRun(async () => {
    const db = admin.firestore();
    const staleThreshold = admin.firestore.Timestamp.fromMillis(Date.now() - SESSION_TIMEOUT_MS);
    functions.logger.info(`[cleanupExpiredSessions] Looking for active/created sessions with lastHeartbeat < ${staleThreshold.toDate().toISOString()}`);
    try {
        // Two queries: (1) stale active/created sessions, (2) done-but-unarchived zombies
        const [expiredSnapshot, zombieSnapshot] = await Promise.all([
            db
                .collectionGroup("sessions")
                .where("status", "in", ["active", "created"])
                .where("lastHeartbeat", "<", staleThreshold)
                .limit(200)
                .get(),
            db
                .collectionGroup("sessions")
                .where("status", "==", "done")
                .where("archived", "==", false)
                .limit(200)
                .get(),
        ]);
        // Merge results, dedup by doc path
        const seen = new Set();
        const allDocs = [];
        for (const doc of [...expiredSnapshot.docs, ...zombieSnapshot.docs]) {
            if (!seen.has(doc.ref.path)) {
                seen.add(doc.ref.path);
                allDocs.push(doc);
            }
        }
        if (allDocs.length === 0) {
            functions.logger.info("[cleanupExpiredSessions] No expired or zombie sessions found");
            return { reaped: 0 };
        }
        const batch = db.batch();
        const reapedSessions = [];
        const now = Date.now();
        for (const doc of allDocs) {
            const data = doc.data();
            const sessionId = doc.id;
            const programId = data.programId || "unknown";
            const userId = doc.ref.parent.parent.id;
            const isZombie = data.status === "done";
            // Calculate time since last heartbeat
            const lastHeartbeatMs = data.lastHeartbeat?.toMillis() || 0;
            const minutesSinceHeartbeat = Math.round((now - lastHeartbeatMs) / 60000);
            // Archive the session
            batch.update(doc.ref, {
                status: "archived",
                archived: true,
                archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                endedAt: admin.firestore.FieldValue.serverTimestamp(),
                reapReason: isZombie ? "zombie_done_unarchived" : "heartbeat_timeout",
                lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Emit relay message to ISO (only for heartbeat timeouts, not zombie cleanup)
            if (!isZombie) {
                const relayRef = db.collection(`tenants/${userId}/relay`).doc();
                batch.set(relayRef, {
                    source: "system",
                    target: "orchestrator",
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
            }
            reapedSessions.push(`${sessionId} (${programId}) [${isZombie ? "zombie" : "stale"}]`);
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