/**
 * updateAttendanceAsAdmin — 管理員通用修改 attendance（任何類型）
 *
 * 用途：admin 月曆 → 詳情卡每筆 record 旁的「編輯」按鈕，可修改任何
 *      attendance doc 的 timestamp / type / note / audit / locationName。
 *      不論該 doc 是 員工補卡 / Admin 代補卡 / 系統虛擬卡 / 請假記錄 / 一般打卡。
 *
 * 安全：
 *   - verifyAdmin（必須是「管理員」dept 或具備 admin role）
 *   - 不限 ownership、audit、adjustmentType；admin 全權
 *   - 記 editedByAdmin / editedAt 審計軌跡，方便追溯
 *
 * 流程：
 *   1. verifyAdmin
 *   2. 讀目標 doc，取舊 userId + 舊 timestamp（用於跨月聚合重算）
 *   3. update 指定欄位（缺欄位的不動）
 *   4. 失效 cache + applyEventToMonthly（若跨月則兩個月份都跑）
 *
 * 前端：
 *   callApifetch({
 *     action: 'updateAttendanceAsAdmin',
 *     id,
 *     timestamp?: ISO string,
 *     type?: '上班' | '下班' | '...',
 *     note?: string,
 *     audit?: '?' | 'v' | 'x',
 *     locationName?: string,
 *   })
 *
 * 回傳：
 *   成功：{ ok: true, code: 'UPDATE_ATTENDANCE_SUCCESS' }
 *   失敗：'ERR_NOT_FOUND' | 'ERR_NO_PERMISSION' | 'ERR_INVALID_DATETIME' | 'ERR_NO_FIELDS_TO_UPDATE'
 */

"use strict";

const admin = require("firebase-admin");
const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifyAdmin } = require("./_helpers");
const {
  applyEventToMonthly,
  invalidateMonthlyCacheForDate,
} = require("./_attendance");

const VALID_AUDIT = new Set(["?", "v", "x"]);
const VALID_TYPE = new Set(["上班", "下班"]); // 其他類型（如請假）admin 不該透過此 endpoint 改 type

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
    const old = snap.data();

    // 收集要更新的欄位
    const updateData = {
      editedByAdmin: auth.user?.userId || "",
      editedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // timestamp
    let newDate = null;
    if (request.data?.timestamp !== undefined) {
      newDate = new Date(request.data.timestamp);
      if (isNaN(newDate.getTime())) {
        return { ok: false, code: "ERR_INVALID_DATETIME" };
      }
      updateData.timestamp = admin.firestore.Timestamp.fromDate(newDate);
    }

    // type
    if (request.data?.type !== undefined && request.data.type !== "") {
      if (!VALID_TYPE.has(request.data.type)) {
        return {
          ok: false,
          code: "ERR_INVALID_TYPE",
          msg: "type 只能為 '上班' 或 '下班'",
        };
      }
      updateData.type = request.data.type;
    }

    // note（admin 改 note 不強制 prefix tag — 完全替換）
    if (request.data?.note !== undefined) {
      updateData.note = String(request.data.note);
    }

    // audit
    if (request.data?.audit !== undefined && request.data.audit !== "") {
      if (!VALID_AUDIT.has(request.data.audit)) {
        return {
          ok: false,
          code: "ERR_INVALID_AUDIT",
          msg: "audit 只能為 '?' / 'v' / 'x'",
        };
      }
      updateData.audit = request.data.audit;
      // 若改為 v 或 x，補上 reviewedAt / reviewedBy
      if (request.data.audit === "v" || request.data.audit === "x") {
        updateData.reviewedAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.reviewedBy = `admin:${auth.user?.userId || ""}`;
      }
    }

    // locationName
    if (request.data?.locationName !== undefined) {
      updateData.locationName = String(request.data.locationName);
    }

    // 至少一個欄位要更新（除 editedByAdmin / editedAt）
    const userFieldCount = Object.keys(updateData).filter(
      (k) => k !== "editedByAdmin" && k !== "editedAt"
    ).length;
    if (userFieldCount === 0) {
      return {
        ok: false,
        code: "ERR_NO_FIELDS_TO_UPDATE",
        msg: "沒有指定要更新的欄位",
      };
    }

    const oldDate = old.timestamp?.toDate?.() || old.timestamp;
    const targetUserId = old.userId;

    await ref.update(updateData);

    // 失效 cache + applyEventToMonthly（跨月則兩個月份都跑）
    if (oldDate && targetUserId) {
      invalidateMonthlyCacheForDate(oldDate, targetUserId);
    }
    if (newDate && targetUserId) {
      invalidateMonthlyCacheForDate(newDate, targetUserId);
    }

    try {
      // 2026-06-10 修正：applyEventToMonthly 是「按日」增量重算。
      // 舊日期永遠重算；新日期只要與舊日期不是同一天（台北時區）也要重算
      // —— 舊版只在「跨月」才重算新日期，同月內改日（5/10→5/20）會漏掉
      // 新日期，該筆紀錄在月曆上消失。
      const taipeiDayKey = (d) =>
        new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (oldDate && targetUserId) {
        await applyEventToMonthly(targetUserId, oldDate);
      }
      if (newDate && targetUserId &&
          (!oldDate || taipeiDayKey(oldDate) !== taipeiDayKey(newDate))) {
        await applyEventToMonthly(targetUserId, newDate);
      }
    } catch (err) {
      console.error(
        `applyEventToMonthly 失敗 user=${targetUserId} (updateAttendanceAsAdmin):`,
        err?.message
      );
    }

    console.log(
      `[admin-edit] doc=${id} target=${targetUserId?.slice?.(0, 8)} ` +
        `by=${auth.user?.userId?.slice?.(0, 8)} fields=${userFieldCount}`
    );

    return {
      ok: true,
      code: "UPDATE_ATTENDANCE_SUCCESS",
      id,
    };
  }
);
