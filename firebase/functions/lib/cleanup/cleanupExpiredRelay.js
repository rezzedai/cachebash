"use strict";
/**
 * Cleanup expired relay messages.
 * Runs every 15 minutes. Deletes PENDING relay messages past their TTL.
 * Delivered messages are kept for audit/tracking until general retention cleanup.
 * Collection group query for scalability.
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
exports.cleanupExpiredRelay = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
exports.cleanupExpiredRelay = functions.pubsub
    .schedule("every 15 minutes")
    .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();
    const fallbackCutoff = new Date(Date.now() - DEFAULT_TTL_MS);
    functions.logger.info(`[cleanupExpiredRelay] Cleaning pending relay messages expired before ${now.toISOString()}`);
    try {
        // Pending messages with explicit expiresAt that have expired
        const expiredByTTL = await db
            .collectionGroup("relay")
            .where("status", "==", "pending")
            .where("expiresAt", "<", now)
            .limit(500)
            .get();
        // Pending messages without expiresAt, older than 24h
        const expiredByAge = await db
            .collectionGroup("relay")
            .where("status", "==", "pending")
            .where("createdAt", "<", fallbackCutoff)
            .limit(500)
            .get();
        // Also clean delivered messages older than 48h (retention)
        const deliveredCutoff = new Date(Date.now() - 2 * DEFAULT_TTL_MS);
        const staleDelivered = await db
            .collectionGroup("relay")
            .where("status", "==", "delivered")
            .where("createdAt", "<", deliveredCutoff)
            .limit(500)
            .get();
        // Deduplicate
        const toDelete = new Map();
        expiredByTTL.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
        expiredByAge.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
        staleDelivered.docs.forEach((doc) => toDelete.set(doc.ref.path, doc.ref));
        if (toDelete.size === 0) {
            functions.logger.info("[cleanupExpiredRelay] No expired relay messages found");
            return { deleted: 0 };
        }
        const batch = db.batch();
        for (const ref of toDelete.values()) {
            batch.delete(ref);
        }
        await batch.commit();
        functions.logger.info(`[cleanupExpiredRelay] Deleted ${toDelete.size} expired relay messages`);
        return { deleted: toDelete.size };
    }
    catch (error) {
        functions.logger.error("[cleanupExpiredRelay] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=cleanupExpiredRelay.js.map