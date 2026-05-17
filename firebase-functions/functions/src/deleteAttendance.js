/**
 * deleteAttendance — 管理員刪除單筆 attendance（補打卡 / 虛擬卡 only）
 *
 * 對應前端：admin 後台月曆「點某天 → 詳情卡」上補打卡 / 虛擬卡的「刪除」按鈕
 *
 * 2026-05-15a：取消原本「只允許刪虛擬卡」白名單，admin 可刪任意 doc
 * 2026-05-15b：因實務考量重新加上白名單 — 一般打卡 / 請假記錄不可刪：
 *   · 一般打卡（adjustmentType=''）：員工親身按打卡按鈕送出，是 source of truth，
 *     誤刪會破壞 attendance 完整性，必須由員工自己作廢或申請補卡
 *   · 請假記錄（adjustmentType='系統請假記錄'）：影響員工權益，需由請假審核流程處理
 *   · 允許刪：補打卡（'補打卡'，員工自補 + Admin 代補同一 type）、系統虛擬卡（'系統虛擬卡'）
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

    // 2026-05-15b：白名單 — 只允許刪除「補打卡」或「系統虛擬卡」
    //   一般打卡 / 請假記錄即使是 admin 也不可刪（保護員工權益 / source of truth）
    const DELETABLE_TYPES = new Set(["補打卡", "系統虛擬卡"]);
    if (!DELETABLE_TYPES.has(data.adjustmentType || "")) {
      return {
        ok: false,
        code: "ERR_NOT_DELETABLE",
        msg: "僅能刪除補打卡或系統虛擬卡。一般打卡 / 請假記錄不可刪除（請改用編輯）",
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
