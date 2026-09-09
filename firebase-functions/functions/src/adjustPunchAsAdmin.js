/**
 * adjustPunchAsAdmin — 管理員代員工補打卡（admin 專用）
 *
 * 對應前端：admin 後台月曆「點某天 → + 代員工補卡」按鈕
 *
 * 與 adjustPunch.js 的差異：
 *   - 用 verifyAdmin 取代 verifySession
 *   - 接受 request.data.targetUserId（必填）→ 寫入 attendance.userId = targetUserId
 *   - audit 直接給 'v'（admin 寫入視為已核准，不需再審核）
 *   - note 末尾追加「[由 admin {adminName} 代補]」標示來源
 *   - LINE 通知 prefix 改成「🛠️ Admin 代員工補卡」
 *
 * 前端呼叫格式：
 *   callApifetch({
 *     action: 'adjustPunchAsAdmin',
 *     targetUserId: 'Uxxx',
 *     type: '上班'|'下班',
 *     datetime: ISO string,
 *     note: '...'（可選）
 *   })
 *
 * 回傳：
 *   成功：{ ok: true, code: "ADJUST_PUNCH_AS_ADMIN_SUCCESS" }
 *   失敗：{ ok: false, code: 'ERR_NO_PERMISSION' | 'ERR_MISSING_TARGET_USER' | ... }
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifyAdmin,
  notifyAdmins,
  formatTaipei,
  clampText,
  isValidPunchType,
  isValidDocId,
  isReasonableAttendanceDate,
  validateCoordinates,
  LINE_CHANNEL_ACCESS_TOKEN,
  CORS_ORIGINS,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: CORS_ORIGINS,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const targetUserId = String(request.data?.targetUserId || "").trim();
    if (!targetUserId) {
      return { ok: false, code: "ERR_MISSING_TARGET_USER", msg: "缺少 targetUserId" };
    }
    // B-L9：targetUserId 直接拼進 employees/{id} 路徑，含 '/' 會拋錯 500
    if (!isValidDocId(targetUserId)) {
      return { ok: false, code: "ERR_MISSING_TARGET_USER", msg: "targetUserId 格式不正確" };
    }

    // B-L7：不得自審自批。代補卡的 audit 直接是 'v'（等同自我核准），
    // 管理員要改自己的打卡請走 punchWithoutLocation / updateAttendanceAsAdmin，
    // 那兩條路徑留得下 editedByAdmin 軌跡且不會偽裝成「他人核准」。
    if (targetUserId === auth.user?.userId) {
      return {
        ok: false,
        code: "ERR_CANNOT_SELF_APPROVE",
        msg: "不可代自己補卡（等同自審自批）",
      };
    }

    const { type, lat, lng, note, datetime } = request.data || {};

    // B-M5：type 白名單。原本直接寫 `type: type || ""`，
    // 傳 type:'請假' + audit:'v' 就能讓該員工當日工時歸零。
    if (!isValidPunchType(type)) {
      return { ok: false, code: "ERR_INVALID_PUNCH_TYPE" };
    }

    const punchDate = datetime ? new Date(datetime) : new Date();
    // B-M5：只驗 isNaN 不夠，年份 9999 會產生垃圾 attendanceMonthly 聚合 doc
    if (!isReasonableAttendanceDate(punchDate)) {
      return { ok: false, code: "ERR_INVALID_DATETIME" };
    }

    // B-M5：座標僅供記錄（代補卡不做地理圍欄），但仍須擋 NaN / Infinity
    let vLat = null;
    let vLng = null;
    if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
      const v = validateCoordinates(lat, lng);
      if (!v.valid) return { ok: false, code: v.error };
      vLat = v.lat;
      vLng = v.lng;
    }

    // 取目標員工資訊（dept / name）寫入 attendance，方便後續查詢顯示
    const targetSnap = await db
      .collection(COLLECTIONS.EMPLOYEES)
      .doc(targetUserId)
      .get();
    if (!targetSnap.exists) {
      return { ok: false, code: "ERR_USER_NOT_FOUND", msg: "目標員工不存在" };
    }
    const target = targetSnap.data();

    const adminName = auth.user?.name || "(未命名)";
    const adminUserId = auth.user?.userId || "";
    // 2026-05-15：tag 移到 prefix，與 [員工補卡] / [系統虛擬卡] 一致，方便 UI / Firestore Console 一眼識別來源
    // B-M5：note 未截斷會撐爆聚合 doc（Firestore 1MiB 上限）→ 整月月曆 500
    const safeNote = clampText(note);
    const noteWithAuditTag = safeNote
      ? `[Admin ${adminName} 代補] ${safeNote}`
      : `[Admin ${adminName} 代補]`;
    const applicationTime = new Date();

    await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: targetUserId,
      dept: target.dept || "",
      name: target.name || "",
      type,
      lat: vLat,
      lng: vLng,
      coords: `申請時間: ${applicationTime.toISOString()}`,
      locationName: "", // 代補卡不填地點
      note: noteWithAuditTag,
      // admin 代補卡視為已核准（admin 動作本身就是核准動作）
      audit: "v",
      adjustmentType: "補打卡",
      applicationTime: admin.firestore.Timestamp.fromDate(applicationTime),
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: `admin:${adminUserId}`,
      // 額外標記方便日後追溯
      createdByAdmin: adminUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    invalidateMonthlyCacheForDate(punchDate, targetUserId);

    try {
      await applyEventToMonthly(targetUserId, punchDate);
    } catch (err) {
      console.error(
        `applyEventToMonthly 失敗 user=${targetUserId} (adjustPunchAsAdmin):`,
        err?.message
      );
    }

    // 通知其他管理員（U-L11：排除動手的自己，操作者不需要被自己的動作洗版）
    const notifMsg =
      `🛠️ Admin 代員工補卡\n` +
      `👤 員工：${target.name || ""}\n` +
      `🧑‍💼 補卡管理員：${adminName}\n` +
      `📝 類型：${type}\n` +
      `📅 補卡時間：${formatTaipei(punchDate)}` +
      (safeNote ? `\n📋 備註：${safeNote}` : "");
    notifyAdmins(notifMsg, LINE_CHANNEL_ACCESS_TOKEN.value(), {
      excludeUserId: adminUserId,
    }).catch((err) => console.error("adjustPunchAsAdmin notifyAdmins 失敗:", err));

    console.log(
      `[admin-action] adjustPunchAsAdmin admin=${adminUserId} target=${targetUserId} ` +
        `type=${type} at=${formatTaipei(punchDate)}`
    );

    return {
      ok: true,
      code: "ADJUST_PUNCH_AS_ADMIN_SUCCESS",
      params: { type, targetUserId },
    };
  }
);
