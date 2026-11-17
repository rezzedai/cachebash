"use strict";
/**
 * Cleanup relay messages by retention.
 * Runs every 15 minutes. Deletes:
 *   - delivered messages older than 48h;
 *   - dead_lettered messages 7 days after their expiresAt (so get_dead_letters
 *     has something to return).
 * It NEVER deletes a pending message. A pending message past its TTL is
 * marked dead_lettered, in place, by processDeadLetters, which is the only
 * function that acts on it: deleting it here would remove it before it was
 * marked and make it invisible to sent/history/dead-letter reads
 * (K0NF26vX, 2026-10-21). Collection group queries for scalability.
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
exports.cleanupExpiredRelay = exports.DEAD_LETTER_RETENTION_MS = void 0;
exports.cleanupRelayByRetention = cleanupRelayByRetention;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("firebase-admin/firestore");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
exports.DEAD_LETTER_RETENTION_MS = 7 * DEFAULT_TTL_MS;
async function cleanupRelayByRetention(db, now = new Date()) {
    const deliveredCutoff = new Date(now.getTime() - 2 * DEFAULT_TTL_MS);
    const staleDelivered = await db
        .collectionGroup("relay")
        .where("status", "==", "delivered")
        .where("createdAt", "<", deliveredCutoff)
        .limit(500)
        .get();
    // Retired 7 days after expiresAt. A dead_lettered doc with no expiresAt falls
    // back to createdAt + default TTL + retention.
    const deadLetterCutoff = new Date(now.getTime() - exports.DEAD_LETTER_RETENTION_MS);
    const staleDeadLettered = await db
        .collectionGroup("relay")
        .where("status", "==", "dead_lettered")
        .where("expiresAt", "<", deadLetterCutoff)
        .limit(500)
        .get();
    const staleDeadLetteredNoExpiry = await db
        .collectionGroup("relay")
        .where("status", "==", "dead_lettered")
        .where("createdAt", "<", new Date(deadLetterCutoff.getTime() - DEFAULT_TTL_MS))
        .limit(500)
        .get();
    const toDelete = new Map();
    staleDelivered.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
    staleDeadLettered.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
    staleDeadLetteredNoExpiry.docs.forEach((doc) => {
        if (doc.data().expiresAt == null)
            toDelete.set(doc.ref.path, doc.ref);
    });
    if (toDelete.size === 0)
        return { deleted: 0 };
    const batch = db.batch();
    for (const ref of toDelete.values()) {
        batch.delete(ref);
    }
    await batch.commit();
    return { deleted: toDelete.size };
}
exports.cleanupExpiredRelay = functions.pubsub
    .schedule("every 15 minutes")
    .onRun(async () => {
    try {
        const result = await cleanupRelayByRetention((0, firestore_1.getFirestore)());
        functions.logger.info(`[cleanupExpiredRelay] Deleted ${result.deleted} relay messages past retention`);
        return result;
    }
    catch (error) {
        functions.logger.error("[cleanupExpiredRelay] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=cleanupExpiredRelay.js.map