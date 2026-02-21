"use strict";
/**
 * Cleanup old ledger entries.
 * Runs daily. Deletes entries older than 30 days.
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
exports.cleanupLedger = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const RETENTION_DAYS = 30;
exports.cleanupLedger = functions.pubsub
    .schedule("every 24 hours")
    .onRun(async () => {
    const db = admin.firestore();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    functions.logger.info(`[cleanupLedger] Deleting ledger entries older than ${cutoff.toISOString()}`);
    try {
        const oldEntries = await db
            .collectionGroup("ledger")
            .where("timestamp", "<", cutoff)
            .limit(500)
            .get();
        if (oldEntries.empty) {
            functions.logger.info("[cleanupLedger] No old ledger entries found");
            return { deleted: 0 };
        }
        const batch = db.batch();
        for (const doc of oldEntries.docs) {
            batch.delete(doc.ref);
        }
        await batch.commit();
        functions.logger.info(`[cleanupLedger] Deleted ${oldEntries.size} old ledger entries`);
        return { deleted: oldEntries.size };
    }
    catch (error) {
        functions.logger.error("[cleanupLedger] Error:", error);
        throw error;
    }
});
//# sourceMappingURL=cleanupLedger.js.map