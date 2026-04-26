/**
 * getAbnormalRecords — 異常打卡記錄
 * 對應 GS：Handlers.gs handleGetAbnormalRecords
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
