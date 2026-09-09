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
const { CORS_ORIGINS, db, COLLECTIONS, verifyAdmin, isValidDocId } = require("./_helpers");
const { applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: CORS_ORIGINS },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const id = String(request.data?.id || "").trim();
    if (!id) return { ok: false, code: "ERR_MISSING_ID", msg: "缺少 attendance id" };
    // B-L9：docId 未驗字元就 .doc()，含 '/' 直接 500
    if (!isValidDocId(id)) {
      return { ok: false, code: "ERR_MISSING_ID", msg: "attendance id 格式不正確" };
    }

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return { ok: false, code: "ERR_NOT_FOUND", msg: "attendance 紀錄不存在" };
    }
    const data = snap.data();

    // 2026-08-04c：白名單放寬 — 一般打卡（adjustmentType=''）改為可刪。
    //   原因：後端 60 秒冷卻（B-M2，punch.js）只擋「同 userId 同 type」的連點，
    //   員工按錯「下班」後馬上按「上班」不會被擋；聚合層的 _dedupeAdjacentSameType
    //   同樣只去重同型，這種誤打卡沒有任何自動修正路徑。
    //   系統從未實作員工端作廢功能 → admin 刪除是唯一出路。
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

    // B-L4：刪前留最小快照供誤刪追查。
    //   原本 JSON.stringify(整筆 doc)，會把 GPS 座標、備註、甚至病假證明 base64
    //   全部寫進 Cloud Logging（保留 30 天、多人可讀）。
    //   改成只留重建所需的非 PII 欄位；真要復原可從審核紀錄與員工確認補齊。
    console.log(
      `[admin-action] deleteAttendance-snapshot docId=${id} ` +
        `user=${data.userId?.slice?.(0, 8)} type=${data.type || ""} ` +
        `adjType=${data.adjustmentType || ""} audit=${data.audit || ""} ` +
        `at=${data.timestamp?.toDate?.()?.toISOString?.() || ""}`
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
