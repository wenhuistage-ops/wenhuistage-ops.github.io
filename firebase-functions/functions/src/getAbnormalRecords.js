/**
 * getAbnormalRecords — 異常打卡記錄
 *
 * @deprecated 2026-04-27：後端內部呼叫 getMonthlyAttendance + detectAbnormal，
 * 與 getCalendarSummary 拿同一份資料。前端已改為從月曆快取的 dailyStatus
 * 純前端計算（js/punch/abnormal-records.js detectAbnormalLocal），避免重複
 * 消耗 Firestore reads。此 endpoint 保留作向後相容，無新呼叫端時可移除。
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifySession } = require("./_helpers");
const { getMonthlyAttendance, detectAbnormal } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { month, userId } = request.data || {};

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    if (!month) return { ok: false, code: "ERR_MISSING_MONTH" };

    const effectiveUserId =
      session.user.dept === "管理員" && userId ? userId : session.user.userId;

    const records = await getMonthlyAttendance(month, effectiveUserId);
    const abnormal = detectAbnormal(records, month);

    return { ok: true, records: abnormal };
  }
);
