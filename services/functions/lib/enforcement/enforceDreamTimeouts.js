"use strict";
/**
 * Kill Mechanism 3: Dream timeout enforcement.
 * Scheduled function that checks for active dreams exceeding their timeout_hours.
 * Runs every 5 minutes.
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
exports.enforceDreamTimeouts = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
exports.enforceDreamTimeouts = functions.pubsub
    .schedule("every 5 minutes")
    .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();
    functions.logger.info("[enforceDreamTimeouts] Checking active dreams for timeout violations");
    try {
        // Iterate all users — dreams are in users/{uid}/tasks
        const usersSnapshot = await db.collection("users").listDocuments();
        let timedOut = 0;
        for (const userRef of usersSnapshot) {
            const dreamsSnapshot = await userRef
                .collection("tasks")
                .where("type", "==", "dream")
                .where("status", "==", "active")
                .get();
            if (dreamsSnapshot.empty)
                continue;
            for (const doc of dreamsSnapshot.docs) {
                const data = doc.data();
                const startedAt = data.startedAt?.toMillis?.();
                const timeoutHours = data.dream?.timeout_hours || 4; // Default 4h
                if (!startedAt) {
                    functions.logger.warn(`Dream ${doc.id} is active but has no startedAt`);
                    continue;
                }
                const elapsedMs = now - startedAt;
                const timeoutMs = timeoutHours * 60 * 60 * 1000;
                if (elapsedMs >= timeoutMs) {
                    const elapsedHours = (elapsedMs / (60 * 60 * 1000)).toFixed(1);
                    functions.logger.warn(`[enforceDreamTimeouts] Dream ${doc.id} timed out: ${elapsedHours}h elapsed >= ${timeoutHours}h limit. Killing.`);
                    await doc.ref.update({
                        status: "failed",
                        "dream.outcome": `Timeout: ${elapsedHours}h elapsed, ${timeoutHours}h limit`,
                        completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    timedOut++;
                }
            }
        }
        functions.logger.info(`[enforceDreamTimeouts] Complete. ${timedOut} dream(s) timed out.`);
        return { timedOut };
    }
    catch (error) {
        functions.logger.error("[enforceDreamTimeouts] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=enforceDreamTimeouts.js.map