/**
 * getCalendarSummary — 月曆輕量摘要（每日 reason + 工時）
 * 對應 GS：Handlers.gs handleGetCalendarSummary + getCachedAttendanceSummary
 *
 * Phase 2（2026-05-05）：改走 attendanceMonthly 物化視圖
 *   - 命中聚合 doc → 1 read 直接回傳
 *   - 未命中（Phase 1.5 backfill 漏網的月份）→ 退回 raw 重算 + transaction 寫入
 *
 * 詳見 docs/plans/Firestore-讀取最佳化-月度聚合計畫.md §3.2 / §3.7
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifySession } = require("./_helpers");
const { getMonthlyDailyStatus } = require("./_attendance");

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

    const dailyStatus = await getMonthlyDailyStatus(effectiveUserId, month);

    return { ok: true, records: { dailyStatus } };
  }
);
