/**
 * updateLeaveAsAdmin — 管理員修改請假記錄的「假別」（管理員專用）
 *
 * 用途：員工申請時選錯假別（例如把事假填成病假）時，管理員直接改比較快。
 *      假別影響薪資倒扣（病假扣半天、事假扣全天），故需一致更新 type/reason/locationName。
 *
 * 安全：
 *   - verifyAdmin
 *   - 目標必須是 adjustmentType='系統請假記錄' 的請假/休假記錄（不可改一般打卡/補卡/虛擬卡）
 *   - leaveGroup / leaveKind 走白名單
 *
 * 前端：callApifetch({ action: 'updateLeaveAsAdmin', id, leaveGroup, leaveKind })
 * 回傳：{ ok:true, code:'UPDATE_LEAVE_SUCCESS' } | { ok:false, code:... }
 */

"use strict";

const admin = require("firebase-admin");
const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifyAdmin } = require("./_helpers");
const { applyEventToMonthly, invalidateMonthlyCacheForDate } = require("./_attendance");

// 假別白名單（對應前端 make-up.js 的請假/休假選項）。
// 薪資倒扣讀 locationName：病假半天、事假/其他全天、年假/特休/補休不扣。
const LEAVE_KINDS = {
  "請假": ["病假", "事假", "其他"],
  "休假": ["年假", "特休", "補休"],
};

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const id = String(request.data?.id || "").trim();
    if (!id) return { ok: false, code: "ERR_MISSING_ID" };

    const group = String(request.data?.leaveGroup || "");
    const kind = String(request.data?.leaveKind || "");
    if (!LEAVE_KINDS[group] || !LEAVE_KINDS[group].includes(kind)) {
      return { ok: false, code: "ERR_INVALID_LEAVE_TYPE", msg: "假別不在白名單" };
    }

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, code: "ERR_NOT_FOUND" };
    const d = snap.data();
    if (d.adjustmentType !== "系統請假記錄") {
      return { ok: false, code: "ERR_NOT_LEAVE", msg: "僅能修改請假/休假記錄的假別" };
    }

    // type=群組（請假/休假），reason 與 locationName=假別（薪資倒扣讀 locationName）
    await ref.update({
      type: group,
      reason: kind,
      locationName: kind,
      editedByAdmin: auth.user?.userId || "",
      editedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 假別變動影響該月薪資倒扣與月曆，失效快取並重算聚合
    const punchDate = d.timestamp?.toDate?.() || d.timestamp;
    if (punchDate && d.userId) {
      invalidateMonthlyCacheForDate(punchDate, d.userId);
      try {
        await applyEventToMonthly(d.userId, punchDate);
      } catch (err) {
        console.error(
          `applyEventToMonthly 失敗 user=${d.userId} (updateLeaveAsAdmin):`,
          err?.message
        );
      }
    }

    console.log(
      `[admin-leave-edit] doc=${id} target=${d.userId?.slice?.(0, 8)} ` +
        `by=${auth.user?.userId?.slice?.(0, 8)} → ${group}/${kind}`
    );

    return { ok: true, code: "UPDATE_LEAVE_SUCCESS", leaveGroup: group, leaveKind: kind };
  }
);
