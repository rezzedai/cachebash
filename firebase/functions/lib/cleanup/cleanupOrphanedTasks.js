"use strict";
/**
 * Cleanup orphaned tasks (active without heartbeat for 30+ minutes).
 * Runs every 5 minutes. Uses collection group query for scalability.
 * Reverts tasks back to created status.
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
exports.cleanupOrphanedTasks = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;
exports.cleanupOrphanedTasks = functions.pubsub
    .schedule("every 5 minutes")
    .onRun(async () => {
    const db = admin.firestore();
    const staleThreshold = Date.now() - ORPHAN_THRESHOLD_MS;
    functions.logger.info(`[cleanupOrphanedTasks] Looking for active tasks with lastHeartbeat < ${new Date(staleThreshold).toISOString()}`);
    try {
        // Collection group query across all users' tasks
        const orphanedSnapshot = await db
            .collectionGroup("tasks")
            .where("status", "==", "active")
            .where("lastHeartbeat", "<", staleThreshold)
            .limit(500)
            .get();
        if (orphanedSnapshot.empty) {
            functions.logger.info("[cleanupOrphanedTasks] No orphaned tasks found");
            return { reverted: 0 };
        }
        const batch = db.batch();
        const revertedIds = [];
        for (const doc of orphanedSnapshot.docs) {
            batch.update(doc.ref, {
                status: "created",
                sessionId: null,
                startedAt: null,
                lastHeartbeat: null,
                revertedAt: admin.firestore.FieldValue.serverTimestamp(),
                revertReason: "heartbeat_timeout",
            });
            revertedIds.push(doc.id);
        }
        await batch.commit();
        functions.logger.info(`[cleanupOrphanedTasks] Reverted ${revertedIds.length} orphaned tasks:`, revertedIds);
        return { reverted: revertedIds.length };
    }
    catch (error) {
        functions.logger.error("[cleanupOrphanedTasks] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=cleanupOrphanedTasks.js.map