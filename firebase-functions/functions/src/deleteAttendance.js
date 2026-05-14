/**
 * deleteAttendance — 刪除單筆 attendance（admin 專用，目前只允許刪虛擬卡）
 *
 * 對應前端：admin 後台月曆「點某天 → 詳情卡」上的「刪除虛擬卡」按鈕
 *
 * 白名單保護：只允許刪除 adjustmentType='系統虛擬卡' 的紀錄
 *   - 防止 admin 誤刪正常打卡 / 補卡 / 請假紀錄
 *   - 若日後需擴大用途，請新增 confirm 機制或細分 endpoint
 *
 * 流程：
 *   1. 驗 admin session
 *   2. 讀目標 doc，驗證 adjustmentType
 *   3. 記下 userId + timestamp（用於後續聚合重算）
 *   4. ref.delete()
 *   5. 呼叫 applyEventToMonthly 同步該日聚合（虛擬卡刪除 → 該日 reason 退回 *_MISSING）
 *
 * 前端呼叫格式：
 *   callApifetch({ action: 'deleteAttendance', id: '<docId>' })
 *
 * 回傳：
 *   成功：{ ok: true, code: "DELETE_VIRTUAL_PUNCH_SUCCESS" }
 *   失敗：{ ok: false, code: 'ERR_NO_PERMISSION' | 'ERR_NOT_FOUND' | 'ERR_NOT_VIRTUAL_PUNCH' }
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

    // 白名單：只允許刪除「系統虛擬卡」
    if (data.adjustmentType !== "系統虛擬卡") {
      return {
        ok: false,
        code: "ERR_NOT_VIRTUAL_PUNCH",
        msg: "只能刪除系統虛擬卡（adjustmentType='系統虛擬卡'），其他紀錄不允許刪除",
      };
    }

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
        `type=${data.type} by=${auth.user?.userId}`
    );

    return {
      ok: true,
      code: "DELETE_VIRTUAL_PUNCH_SUCCESS",
      deletedId: id,
      affectedUserId: userId,
    };
  }
);
