/**
 * deleteAttendance — 管理員刪除單筆 attendance（補打卡 / 虛擬卡 only）
 *
 * 對應前端：admin 後台月曆「點某天 → 詳情卡」上補打卡 / 虛擬卡的「刪除」按鈕
 *
 * 2026-05-15a：取消原本「只允許刪虛擬卡」白名單，admin 可刪任意 doc
 * 2026-05-15b：因實務考量重新加上白名單 — 一般打卡 / 請假記錄不可刪
 * 2026-08-04c：一般打卡改回可刪（員工按錯上/下班的實務需求，見下方白名單註解）
 *   · 允許刪：一般打卡（''）、補打卡（'補打卡'）、系統虛擬卡（'系統虛擬卡'）
 *   · 不可刪：請假記錄（'系統請假記錄'）— 影響員工權益，改假別走 updateLeaveAsAdmin
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

    // 2026-08-04c：白名單放寬 — 一般打卡（adjustmentType=''）改為可刪。
    //   原因：60 秒冷卻只擋「同型」連點，員工按錯「下班」後馬上按「上班」不會被擋，
    //   聚合層的 _dedupeAdjacentSameType 也只去重同型，這種誤打卡沒有任何自動修正路徑。
    //   舊註解說「由員工自己作廢」，但系統從未實作作廢功能 → admin 刪除是唯一出路。
    //   請假記錄仍不可刪：影響員工權益，改假別請走 updateLeaveAsAdmin（編輯）。
    const DELETABLE_TYPES = new Set(["", "補打卡", "系統虛擬卡"]);
    if (!DELETABLE_TYPES.has(data.adjustmentType || "")) {
      return {
        ok: false,
        code: "ERR_NOT_DELETABLE",
        msg: "請假記錄不可刪除，請改用編輯修改假別",
      };
    }

    const userId = data.userId;
    const punchDate = data.timestamp?.toDate?.() || data.timestamp;

    // ponytail: 刪前把整筆內容寫進 log，誤刪可從 Cloud Logging 撈回手動重建。
    //   比加 deleted 欄位做軟刪除便宜 — 那要改所有 attendance 查詢加 where 條件。
    //   若誤刪頻繁到需要一鍵還原，再考慮軟刪除。
    console.log(
      `[admin-action] deleteAttendance-snapshot docId=${id} data=${JSON.stringify(data)}`
    );

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
