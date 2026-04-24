/**
 * getCalendarSummary — 月曆輕量摘要（每日 reason + 工時）
 * 對應 GS：Handlers.gs handleGetCalendarSummary + getCachedAttendanceSummary
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifySession } = require("./_helpers");
const { getMonthlyAttendance, summarizeByDay } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { month, userId } = request.data || {};

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    if (!month) return { ok: false, code: "ERR_MISSING_MONTH" };

    // 權限：一般員工只能看自己；管理員可查指定 userId
    const effectiveUserId =
      session.user.dept === "管理員" && userId ? userId : session.user.userId;

    const records = await getMonthlyAttendance(month, effectiveUserId);
    const dailyStatus = summarizeByDay(records);

    return { ok: true, records: { dailyStatus } };
  }
);
