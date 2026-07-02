/**
 * getAttendanceDetails — 月度打卡詳情
 *
 * @deprecated 2026-04-27：與 getCalendarSummary 回傳完全相同的 dailyStatus，
 * 前端已統一改走 getCalendarSummary（避免同一份資料重複呼叫消耗 Firestore reads）。
 * 此 endpoint 保留作向後相容，無新呼叫端時可移除。
 *
 * Phase 2（2026-05-05）：與 getCalendarSummary 同步切換到 attendanceMonthly 聚合層。
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifySession, isValidMonth } = require("./_helpers");
const { getMonthlyDailyStatus } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { month, userId, targetUserId } = request.data || {};

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    if (!isValidMonth(month)) return { ok: false, code: "ERR_MISSING_MONTH" };

    const requested = userId || targetUserId;
    const effectiveUserId =
      session.user.dept === "管理員" && requested ? requested : session.user.userId;

    const dailyStatus = await getMonthlyDailyStatus(effectiveUserId, month);

    return { ok: true, records: { dailyStatus } };
  }
);
