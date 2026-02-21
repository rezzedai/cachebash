"use strict";
/**
 * Process dead letter queue.
 * Runs every 15 minutes. Finds pending relay messages that have been
 * undelivered for too long, increments delivery attempts, and moves
 * them to the dead_letters collection after max attempts exceeded.
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
exports.processDeadLetters = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const MAX_DELIVERY_ATTEMPTS = 3;
const DEAD_LETTER_AGE_MS = 60 * 60 * 1000; // 1 hour
exports.processDeadLetters = functions.pubsub
    .schedule("every 15 minutes")
    .onRun(async () => {
    const db = admin.firestore();
    const cutoff = new Date(Date.now() - DEAD_LETTER_AGE_MS);
    functions.logger.info(`[processDeadLetters] Checking for undelivered messages older than ${cutoff.toISOString()}`);
    try {
        // Find pending relay messages older than 1 hour
        const pendingDocs = await db
            .collectionGroup("relay")
            .where("status", "==", "pending")
            .where("createdAt", "<", cutoff)
            .limit(500)
            .get();
        if (pendingDocs.empty) {
            functions.logger.info("[processDeadLetters] No pending messages to process");
            return { processed: 0, deadLettered: 0 };
        }
        let processed = 0;
        let deadLettered = 0;
        // Process in batches of 500 (Firestore limit)
        const batch = db.batch();
        for (const doc of pendingDocs.docs) {
            const data = doc.data();
            const attempts = (data.deliveryAttempts || 0) + 1;
            const maxAttempts = data.maxDeliveryAttempts || MAX_DELIVERY_ATTEMPTS;
            if (attempts >= maxAttempts) {
                // Move to dead letter queue
                // Extract userId from doc path: users/{uid}/relay/{id}
                const pathParts = doc.ref.path.split("/");
                const userId = pathParts[1];
                const deadLetterRef = db.doc(`users/${userId}/dead_letters/${doc.id}`);
                batch.set(deadLetterRef, {
                    ...data,
                    status: "dead_letter",
                    deliveryAttempts: attempts,
                    deadLetteredAt: admin.firestore.FieldValue.serverTimestamp(),
                    originalPath: doc.ref.path,
                });
                // Delete from relay
                batch.delete(doc.ref);
                deadLettered++;
            }
            else {
                // Increment delivery attempts
                batch.update(doc.ref, {
                    deliveryAttempts: attempts,
                });
            }
            processed++;
        }
        await batch.commit();
        functions.logger.info(`[processDeadLetters] Processed ${processed} messages, dead-lettered ${deadLettered}`);
        return { processed, deadLettered };
    }
    catch (error) {
        functions.logger.error("[processDeadLetters] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=processDeadLetters.js.map