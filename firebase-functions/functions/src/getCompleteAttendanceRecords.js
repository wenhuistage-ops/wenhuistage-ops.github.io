/**
 * getCompleteAttendanceRecords — 原始打卡紀錄（Excel 匯出用）
 * 對應 GS：Handlers.gs handleGetCompleteAttendanceRecords
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifySession } = require("./_helpers");
const { getMonthlyAttendance } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { month, userId, targetUserId } = request.data || {};

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    if (!month) return { ok: false, code: "ERR_MISSING_MONTH" };

    const requested = userId || targetUserId;
    const effectiveUserId =
      session.user.dept === "管理員" && requested ? requested : session.user.userId;

    const records = await getMonthlyAttendance(month, effectiveUserId);

    // 回傳原始打卡記錄（對應 GS 版格式）
    return {
      ok: true,
      records: records.map((r) => ({
        date: r.date,
        userId: r.userId,
        salary: null, // GS 版放薪資，本分支已移除薪資；保留欄位相容
        name: r.name,
        type: r.type,
        gps: r.coords || "",
        location: r.locationName || "",
        note: r.note || "",
        audit: r.audit || "",
        device: "",
      })),
    };
  }
);
