/**
 * deleteAdjustRequest — 員工刪除自己尚未通過的補卡申請
 *
 * 用途：員工在「我的申請」頁面，對 audit='?' 的補卡申請整筆刪除（取消申請）。
 *
 * 安全條件（白名單）：
 *   1. attendance.userId === session.user.userId
 *   2. attendance.audit === '?'（已核准 / 已退回都不可刪）
 *   3. attendance.adjustmentType === '補打卡'
 *
 * 流程：
 *   1. verifySession
 *   2. 讀目標 doc，驗 ownership + audit + adjustmentType
 *   3. ref.delete()
 *   4. 呼叫 applyEventToMonthly 同步聚合（補卡少一筆 → 該日 reason 退回原狀）
 *
 * 前端：
 *   callApifetch({ action: 'deleteAdjustRequest', id })
 *
 * 回傳：
 *   成功：{ ok: true, code: 'DELETE_ADJUST_REQUEST_SUCCESS' }
 *   失敗：'ERR_NOT_FOUND' | 'ERR_NO_PERMISSION' | 'ERR_ALREADY_REVIEWED' | 'ERR_NOT_ADJUSTMENT'
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifySession } = require("./_helpers");
const { applyEventToMonthly, invalidateMonthlyCacheForDate } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const id = String(request.data?.id || "").trim();
    if (!id) return { ok: false, code: "ERR_MISSING_ID", msg: "缺少申請 id" };

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return { ok: false, code: "ERR_NOT_FOUND", msg: "申請不存在" };
    }
    const data = snap.data();

    if (data.userId !== session.user.userId) {
      return { ok: false, code: "ERR_NO_PERMISSION", msg: "只能刪除自己的補卡申請" };
    }
    if (data.audit !== "?") {
      return {
        ok: false,
        code: "ERR_ALREADY_REVIEWED",
        msg: "此申請已審核（已核准或已退回），不能再刪除",
      };
    }
    if (data.adjustmentType !== "補打卡") {
      return {
        ok: false,
        code: "ERR_NOT_ADJUSTMENT",
        msg: "僅能刪除 adjustmentType='補打卡' 的紀錄",
      };
    }

    const punchDate = data.timestamp?.toDate?.() || data.timestamp;

    await ref.delete();

    if (punchDate) {
      invalidateMonthlyCacheForDate(punchDate, session.user.userId);
      try {
        await applyEventToMonthly(session.user.userId, punchDate);
      } catch (err) {
        console.error(
          `applyEventToMonthly 失敗 user=${session.user.userId} (deleteAdjustRequest):`,
          err?.message
        );
      }
    }

    console.log(
      `[adjust-delete] id=${id} user=${session.user.userId.slice(0, 8)} ` +
        `ts=${punchDate?.toISOString?.()} type=${data.type}`
    );

    return {
      ok: true,
      code: "DELETE_ADJUST_REQUEST_SUCCESS",
      deletedId: id,
    };
  }
);
