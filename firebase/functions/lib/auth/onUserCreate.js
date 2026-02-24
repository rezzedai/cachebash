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
exports.onUserCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const db = admin.firestore();
/**
 * Triggered when a new user is created in Firebase Auth.
 * Auto-provisions tenant namespace with config, first API key, and preferences.
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const { uid, email, displayName, photoURL, providerData } = user;
    const provider = providerData?.[0]?.providerId || "unknown";
    try {
        // 1. Generate first API key
        const rawKey = `cb_${crypto.randomBytes(32).toString("hex")}`;
        const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
        // 2. Create tenant root doc
        await db.doc(`tenants/${uid}`).set({
            email: email || null,
            displayName: displayName || null,
            photoURL: photoURL || null,
            provider,
            plan: "free",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // 3. Create config/preferences doc
        await db.doc(`tenants/${uid}/config/preferences`).set({
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            tourCompleted: false,
            plan: "free",
            notificationsEnabled: true,
        });
        // 4. Store API key in keyIndex (same pattern as mcp-server keys module)
        await db.doc(`keyIndex/${keyHash}`).set({
            userId: uid,
            programId: "default",
            label: "Default API Key",
            capabilities: ["*"],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
        });
        // 5. Store first key for one-time display in mobile app
        await db.doc(`tenants/${uid}/config/firstKey`).set({
            key: Buffer.from(rawKey).toString("base64"),
            keyHash,
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
            retrieved: false,
        });
        // 6. Create billing config (free tier default)
        await db.doc(`tenants/${uid}/config/billing`).set({
            tier: "free",
            limits: {
                programs: 3,
                tasksPerMonth: 500,
                concurrentSessions: 1,
            },
            softWarnOnly: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        functions.logger.info(`Tenant provisioned for ${uid} (${email}), provider: ${provider}`);
    }
    catch (error) {
        functions.logger.error(`Failed to provision tenant for ${uid}`, error);
        throw error;
    }
});
//# sourceMappingURL=onUserCreate.js.map