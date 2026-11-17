"use strict";
/**
 * Dead-letter expired relay messages.
 * Runs every 15 minutes. A pending relay message is deliverable until its
 * expiresAt (the sender's TTL, default 24h). Past that, it is marked
 * status "dead_lettered" IN PLACE, in tenants/{uid}/relay, so get_sent_messages,
 * query_message_history and get_dead_letters can still see it.
 *
 * This function used to dead-letter on AGE (pending for 1h, three runs) and
 * then copy the doc to tenants/{uid}/dead_letters and DELETE it from relay. A
 * message to a slow reader (TENSOR reads from occasional sessions) was removed
 * about 1.5-2h after sending, unread, and no tool could see it again
 * (2026-10-21, K0NF26vX). It never deletes and never copies now.
 *
 * Fields written match mcp-server's cleanupExpiredRelayMessages.
 *
 * ORDERING WITH THE OTHER REAPERS (all every 15 minutes, order unspecified):
 *   - this function is the ONLY one that acts on a pending relay doc past its
 *     TTL (reapExpiredByTTL no longer handles relay; cleanupExpiredRelay never
 *     touches a pending doc), so there is no race on the expiresAt boundary;
 *   - cleanupExpiredRelay retires a dead_lettered doc 7 days after its expiresAt.
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
exports.deadLetterExpiredRelay = deadLetterExpiredRelay;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("firebase-admin/firestore");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;
const BATCH_LIMIT = 400; // Firestore batch cap is 500
async function deadLetterExpiredRelay(db, now = new Date()) {
    const fallbackCutoff = new Date(now.getTime() - DEFAULT_TTL_MS);
    // Pending past its explicit expiresAt.
    const expiredByTTL = await db
        .collectionGroup("relay")
        .where("status", "==", "pending")
        .where("expiresAt", "<", now)
        .limit(BATCH_LIMIT)
        .get();
    // Pending with no expiresAt at all: older than the default TTL. A doc that
    // has an expiresAt in the future is NOT expired, however old it is.
    const expiredByAge = await db
        .collectionGroup("relay")
        .where("status", "==", "pending")
        .where("createdAt", "<", fallbackCutoff)
        .limit(BATCH_LIMIT)
        .get();
    const targets = new Map();
    expiredByTTL.docs.forEach((doc) => targets.set(doc.ref.path, doc));
    expiredByAge.docs.forEach((doc) => {
        if (doc.data().expiresAt == null)
            targets.set(doc.ref.path, doc);
    });
    if (targets.size === 0)
        return { deadLettered: 0 };
    const batch = db.batch();
    for (const doc of targets.values()) {
        const data = doc.data();
        const attempts = data.deliveryAttempts || 0;
        const maxAttempts = data.maxDeliveryAttempts || MAX_DELIVERY_ATTEMPTS;
        batch.update(doc.ref, {
            status: "dead_lettered",
            reason: "TTL expired",
            dead_letter_reason: "EXPIRED_TTL",
            dead_letter_class: attempts >= maxAttempts ? "MAX_ATTEMPTS_EXCEEDED" : "EXPIRED_TTL",
            deadLetteredAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    return { deadLettered: targets.size };
}
exports.processDeadLetters = functions.pubsub
    .schedule("every 15 minutes")
    .onRun(async () => {
    try {
        const result = await deadLetterExpiredRelay((0, firestore_1.getFirestore)());
        functions.logger.info(`[processDeadLetters] Dead-lettered ${result.deadLettered} expired pending messages in place`);
        return result;
    }
    catch (error) {
        functions.logger.error("[processDeadLetters] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=processDeadLetters.js.map