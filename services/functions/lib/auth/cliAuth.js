"use strict";
/**
 * CLI Auth Cloud Functions — Browser-based authentication for `cachebash init`.
 *
 * Two endpoints:
 * 1. cliAuthApprove — Called by browser after user authenticates (POST)
 * 2. cliAuthStatus — Called by CLI polling for approval (GET)
 *
 * Flow: CLI generates session token → opens browser → browser authenticates →
 * calls approve → CLI polls status → gets API key → session deleted.
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
exports.cliAuthStatus = exports.cliAuthApprove = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const crypto_1 = require("crypto");
const structuredLog_1 = require("../util/structuredLog");
const db = admin.firestore();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
// CORS: only allow the Firebase Hosting origin (where cli-auth.html is served)
const ALLOWED_ORIGINS = [
    "https://cachebash-app.web.app",
    "https://cachebash-app.firebaseapp.com",
    "https://app.cachebash.dev",
];
function setCorsHeaders(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Vary", "Origin");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return true;
    }
    return false;
}
/**
 * POST — Called by the browser after user authenticates via Firebase Auth.
 * Idempotent: if session is already approved, returns success without creating
 * a new key. Uses a transaction to prevent concurrent approve races.
 *
 * Body: { sessionToken: string, idToken: string }
 */
exports.cliAuthApprove = functions.https.onRequest(async (req, res) => {
    if (setCorsHeaders(req, res))
        return;
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    const startTime = Date.now();
    try {
        const { sessionToken, idToken } = req.body;
        if (!sessionToken || !idToken) {
            res.status(400).json({ error: "Missing sessionToken or idToken" });
            return;
        }
        // Verify the Firebase ID token
        const decoded = await admin.auth().verifyIdToken(idToken);
        const userId = decoded.uid;
        const sessionRef = db.collection("cli_sessions").doc(sessionToken);
        await db.runTransaction(async (tx) => {
            const sessionDoc = await tx.get(sessionRef);
            // Idempotent: if already approved, do nothing
            if (sessionDoc.exists && sessionDoc.data()?.status === "approved") {
                return;
            }
            // Check active key count (max 10)
            const existingKeys = await db
                .collection("keyIndex")
                .where("userId", "==", userId)
                .where("active", "==", true)
                .get();
            if (existingKeys.size >= 10) {
                throw new functions.https.HttpsError("resource-exhausted", "Maximum 10 active API keys. Revoke an existing key first.");
            }
            // Generate API key
            const rawKey = `cb_live_${(0, crypto_1.randomBytes)(24).toString("hex")}`;
            const keyHash = (0, crypto_1.createHash)("sha256").update(rawKey).digest("hex");
            const now = admin.firestore.FieldValue.serverTimestamp();
            // Write API key to keyIndex
            tx.set(db.collection("keyIndex").doc(keyHash), {
                userId,
                programId: "default",
                label: "CLI (auto-generated)",
                capabilities: [
                    "dispatch.read", "dispatch.write",
                    "relay.read", "relay.write",
                    "pulse.read",
                    "signal.read", "signal.write",
                    "sprint.read",
                    "metrics.read", "fleet.read",
                ],
                active: true,
                createdAt: now,
                createdBy: "cli-auth",
            });
            // Store CLI session (for polling)
            tx.set(sessionRef, {
                userId,
                apiKey: rawKey,
                status: "approved",
                expiresAt: new Date(Date.now() + SESSION_TTL_MS),
                createdAt: now,
            });
        });
        (0, structuredLog_1.logSuccess)({
            function: "cliAuthApprove",
            uid: userId,
            action: "approve_cli_session",
            durationMs: Date.now() - startTime,
        });
        res.status(200).json({ success: true });
    }
    catch (err) {
        if (err.code === "resource-exhausted") {
            res.status(400).json({ error: err.message });
            return;
        }
        (0, structuredLog_1.logError)({
            function: "cliAuthApprove",
            uid: null,
            action: "approve_cli_session",
            durationMs: Date.now() - startTime,
        }, err);
        res.status(500).json({ error: "Authentication failed" });
    }
});
/**
 * GET — Called by CLI polling for approval status.
 * Uses a transaction to atomically read + delete the session (TOCTOU fix).
 * Only the first successful poll gets the API key; subsequent calls get 404.
 *
 * Query: ?session={token}
 * Returns: { status: "pending" | "approved" | "expired", apiKey?, userId? }
 */
exports.cliAuthStatus = functions.https.onRequest(async (req, res) => {
    if (setCorsHeaders(req, res))
        return;
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    const sessionToken = req.query.session;
    if (!sessionToken) {
        res.status(400).json({ error: "Missing session parameter" });
        return;
    }
    const startTime = Date.now();
    try {
        const sessionRef = db.collection("cli_sessions").doc(sessionToken);
        const result = await db.runTransaction(async (tx) => {
            const doc = await tx.get(sessionRef);
            if (!doc.exists) {
                return { status: "pending" };
            }
            const data = doc.data();
            // Check expiration
            const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
            if (expiresAt < new Date()) {
                tx.delete(sessionRef);
                return { status: "expired" };
            }
            if (data.status === "approved") {
                // Atomic read + delete — only first caller gets the key
                tx.delete(sessionRef);
                return {
                    status: "approved",
                    apiKey: data.apiKey,
                    userId: data.userId,
                };
            }
            return { status: data.status || "pending" };
        });
        (0, structuredLog_1.logSuccess)({
            function: "cliAuthStatus",
            uid: null,
            action: "poll_cli_status",
            durationMs: Date.now() - startTime,
        });
        res.status(200).json(result);
    }
    catch (err) {
        (0, structuredLog_1.logError)({
            function: "cliAuthStatus",
            uid: null,
            action: "poll_cli_status",
            durationMs: Date.now() - startTime,
        }, err);
        res.status(500).json({ error: "Status check failed" });
    }
});
//# sourceMappingURL=cliAuth.js.map