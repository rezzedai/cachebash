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
exports.cleanupAudit = exports.processDeadLetters = exports.cleanupLedger = exports.cleanupExpiredRelay = exports.cleanupOrphanedTasks = exports.cleanupExpiredSessions = exports.onAnalyticsEventCreate = exports.onRelayCreate = exports.onSessionUpdate = exports.onTaskUpdate = exports.onTaskCreate = exports.onUserCreate = void 0;
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
// Auth triggers
var onUserCreate_1 = require("./auth/onUserCreate");
Object.defineProperty(exports, "onUserCreate", { enumerable: true, get: function () { return onUserCreate_1.onUserCreate; } });
// Notification triggers (new collection paths)
var onTaskCreate_1 = require("./notifications/onTaskCreate");
Object.defineProperty(exports, "onTaskCreate", { enumerable: true, get: function () { return onTaskCreate_1.onTaskCreate; } });
var onTaskUpdate_1 = require("./notifications/onTaskUpdate");
Object.defineProperty(exports, "onTaskUpdate", { enumerable: true, get: function () { return onTaskUpdate_1.onTaskUpdate; } });
var onSessionUpdate_1 = require("./notifications/onSessionUpdate");
Object.defineProperty(exports, "onSessionUpdate", { enumerable: true, get: function () { return onSessionUpdate_1.onSessionUpdate; } });
var onRelayCreate_1 = require("./notifications/onRelayCreate");
Object.defineProperty(exports, "onRelayCreate", { enumerable: true, get: function () { return onRelayCreate_1.onRelayCreate; } });
// Analytics aggregation
var onAnalyticsEventCreate_1 = require("./analytics/onAnalyticsEventCreate");
Object.defineProperty(exports, "onAnalyticsEventCreate", { enumerable: true, get: function () { return onAnalyticsEventCreate_1.onAnalyticsEventCreate; } });
// Scheduled cleanup
var cleanupExpiredSessions_1 = require("./cleanup/cleanupExpiredSessions");
Object.defineProperty(exports, "cleanupExpiredSessions", { enumerable: true, get: function () { return cleanupExpiredSessions_1.cleanupExpiredSessions; } });
var cleanupOrphanedTasks_1 = require("./cleanup/cleanupOrphanedTasks");
Object.defineProperty(exports, "cleanupOrphanedTasks", { enumerable: true, get: function () { return cleanupOrphanedTasks_1.cleanupOrphanedTasks; } });
var cleanupExpiredRelay_1 = require("./cleanup/cleanupExpiredRelay");
Object.defineProperty(exports, "cleanupExpiredRelay", { enumerable: true, get: function () { return cleanupExpiredRelay_1.cleanupExpiredRelay; } });
var cleanupLedger_1 = require("./cleanup/cleanupLedger");
Object.defineProperty(exports, "cleanupLedger", { enumerable: true, get: function () { return cleanupLedger_1.cleanupLedger; } });
var processDeadLetters_1 = require("./cleanup/processDeadLetters");
Object.defineProperty(exports, "processDeadLetters", { enumerable: true, get: function () { return processDeadLetters_1.processDeadLetters; } });
var cleanupAudit_1 = require("./cleanup/cleanupAudit");
Object.defineProperty(exports, "cleanupAudit", { enumerable: true, get: function () { return cleanupAudit_1.cleanupAudit; } });
//# sourceMappingURL=index.js.map