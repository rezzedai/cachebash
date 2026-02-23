"use strict";
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
exports.onAnalyticsEventCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const helpers_1 = require("./helpers");
const db = admin.firestore();
/**
 * Triggered when a new analytics event is created.
 * Aggregates counters into daily, weekly, and monthly rollups
 * using atomic increment — no read-before-write.
 */
exports.onAnalyticsEventCreate = functions.firestore
    .document("users/{userId}/analytics_events/{eventId}")
    .onCreate(async (snapshot, context) => {
    const { userId } = context.params;
    const data = snapshot.data();
    const eventType = data.eventType;
    const programId = data.programId;
    const timestamp = data.timestamp;
    // Skip if missing required eventType
    if (!eventType) {
        functions.logger.warn("Analytics event missing eventType, skipping aggregation");
        return;
    }
    // Parse timestamp — handle Firestore Timestamp, ISO string, or fallback to now
    let date;
    if (timestamp && typeof timestamp.toDate === "function") {
        date = timestamp.toDate();
    }
    else if (typeof timestamp === "string") {
        date = new Date(timestamp);
    }
    else {
        date = new Date();
    }
    if (isNaN(date.getTime())) {
        functions.logger.warn("Analytics event has invalid timestamp, using current time");
        date = new Date();
    }
    const keys = (0, helpers_1.buildAggregateKeys)(date);
    const increment = admin.firestore.FieldValue.increment(1);
    const aggregatesRef = db.collection(`users/${userId}/analytics_aggregates`);
    // Build the update payload — same shape for all three periods
    const update = {
        totalEvents: increment,
        [`byType.${eventType}`]: increment,
    };
    if (programId) {
        update[`byProgram.${programId}`] = increment;
    }
    const options = { merge: true };
    try {
        await Promise.all([
            aggregatesRef.doc(keys.daily).set(update, options),
            aggregatesRef.doc(keys.weekly).set(update, options),
            aggregatesRef.doc(keys.monthly).set(update, options),
        ]);
    }
    catch (error) {
        functions.logger.error("Failed to write analytics aggregates", error);
    }
});
//# sourceMappingURL=onAnalyticsEventCreate.js.map