/**
 * deleteAttendance — 管理員刪除單筆 attendance（任何類型）
 *
 * 對應前端：admin 後台月曆「點某天 → 詳情卡」上每筆 record 的「刪除」按鈕
 *   （含虛擬卡 / 員工補卡 / Admin 代補卡 / 請假記錄 / 一般打卡）
 *
 * 2026-05-15：取消原本「只允許刪虛擬卡」白名單。
 *   - admin 全權，前端 UI 端 confirm 即可
 *   - 記 deletedByAdmin / deletedAt log（雖然 doc 被 delete，仍可在 Cloud Logging 找回）
 *
 * 流程：
 *   1. 驗 admin session
 *   2. 讀目標 doc，記下 userId + timestamp（用於後續聚合重算）
 *   3. ref.delete()
 *   4. 呼叫 applyEventToMonthly 同步該日聚合
 *
 * 前端呼叫格式：
 *   callApifetch({ action: 'deleteAttendance', id: '<docId>' })
 *
 * 回傳：
 *   成功：{ ok: true, code: "DELETE_ATTENDANCE_SUCCESS" }
 *   失敗：{ ok: false, code: 'ERR_NO_PERMISSION' | 'ERR_NOT_FOUND' }
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifyAdmin } = require("./_helpers");
const { applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const id = String(request.data?.id || "").trim();
    if (!id) return { ok: false, code: "ERR_MISSING_ID", msg: "缺少 attendance id" };

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return { ok: false, code: "ERR_NOT_FOUND", msg: "attendance 紀錄不存在" };
    }
    const data = snap.data();

    // 2026-05-15：admin 全權刪除（取消「只允許虛擬卡」白名單）
    const userId = data.userId;
    const punchDate = data.timestamp?.toDate?.() || data.timestamp;

    await ref.delete();

    // 同步 attendanceMonthly 聚合：該日重新算（虛擬卡少一筆 → reason 退回 *_MISSING）
    if (userId && punchDate) {
      try {
        await applyEventToMonthly(userId, punchDate);
      } catch (err) {
        console.error(
          `applyEventToMonthly 失敗 user=${userId} (deleteAttendance):`,
          err?.message
        );
      }
    }

    console.log(
      `[admin-action] deleteAttendance docId=${id} user=${userId?.slice(0, 8)} ` +
        `type=${data.type} adjType=${data.adjustmentType || ""} by=${auth.user?.userId}`
    );

    return {
      ok: true,
      code: "DELETE_ATTENDANCE_SUCCESS",
      deletedId: id,
      affectedUserId: userId,
    };
  }
);
