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
  LINE_CHANNEL_ACCESS_TOKEN,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
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

    const { type, lat, lng, note, datetime } = request.data || {};

    const punchDate = datetime ? new Date(datetime) : new Date();
    if (isNaN(punchDate.getTime())) {
      return { ok: false, code: "ERR_INVALID_DATETIME" };
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
    const noteWithAuditTag = note
      ? `[Admin ${adminName} 代補] ${note}`
      : `[Admin ${adminName} 代補]`;
    const applicationTime = new Date();

    await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: targetUserId,
      dept: target.dept || "",
      name: target.name || "",
      type: type || "",
      lat: lat !== undefined ? Number(lat) : null,
      lng: lng !== undefined ? Number(lng) : null,
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

    // 通知所有管理員（含 admin 自己），讓其他 admin 也知道
    const notifMsg =
      `🛠️ Admin 代員工補卡\n` +
      `👤 員工：${target.name || ""}\n` +
      `🧑‍💼 補卡管理員：${adminName}\n` +
      `📝 類型：${type || ""}\n` +
      `📅 補卡時間：${formatTaipei(punchDate)}` +
      (note ? `\n📋 備註：${note}` : "");
    notifyAdmins(notifMsg, LINE_CHANNEL_ACCESS_TOKEN.value()).catch((err) =>
      console.error("adjustPunchAsAdmin notifyAdmins 失敗:", err)
    );

    console.log(
      `[admin-action] adjustPunchAsAdmin admin=${adminUserId} target=${targetUserId} ` +
        `type=${type} at=${formatTaipei(punchDate)}`
    );

    return {
      ok: true,
      code: "ADJUST_PUNCH_AS_ADMIN_SUCCESS",
      params: { type: type || "", targetUserId },
    };
  }
);
