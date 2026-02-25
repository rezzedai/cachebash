"use strict";
/**
 * Pure helper functions for analytics aggregation.
 * No Firebase dependencies — safe to import in tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getISOWeek = getISOWeek;
exports.getISOWeekYear = getISOWeekYear;
exports.buildAggregateKeys = buildAggregateKeys;
/**
 * Get ISO 8601 week number for a date.
 * Week 1 is the week containing the first Thursday of the year.
 */
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
/**
 * Get the ISO week year (may differ from calendar year at year boundaries).
 */
function getISOWeekYear(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return d.getUTCFullYear();
}
/**
 * Build aggregate document keys from a timestamp.
 * Returns keys for daily, weekly, and monthly aggregate documents.
 */
function buildAggregateKeys(timestamp) {
    const yyyy = timestamp.getUTCFullYear();
    const mm = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(timestamp.getUTCDate()).padStart(2, "0");
    const weekNum = getISOWeek(timestamp);
    const weekYear = getISOWeekYear(timestamp);
    return {
        daily: `daily_${yyyy}-${mm}-${dd}`,
        weekly: `weekly_${weekYear}-W${String(weekNum).padStart(2, "0")}`,
        monthly: `monthly_${yyyy}-${mm}`,
    };
}
//# sourceMappingURL=helpers.js.map