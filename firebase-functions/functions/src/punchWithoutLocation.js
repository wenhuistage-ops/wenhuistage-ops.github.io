/**
 * punchWithoutLocation — 管理員無定位打卡
 * 對應 GS：Handlers.gs handlePunchWithoutLocation
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifyAdmin,
  clampText,
  isValidPunchType,
  checkPunchCooldown,
  CORS_ORIGINS,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: CORS_ORIGINS },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { type, note } = request.data || {};

    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    // B-M5：type 走共用白名單（原本各檔各寫一份，管理員端容易漏）
    if (!isValidPunchType(type)) {
      return { ok: false, code: "ERR_INVALID_PUNCH_TYPE" };
    }

    const user = auth.user;

    // B-M2：與 punch.js 同樣的 60 秒重複打卡防護（管理員也會連點）
    const cooldown = await checkPunchCooldown(user.userId, type);
    if (!cooldown.ok) return cooldown;

    const now = new Date();
    await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(now),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type,
      coords: "無定位",
      locationName: "管理員手動授權",
      // B-M5：note 未截斷會撐爆 attendanceMonthly 聚合 doc（Firestore 1MiB 上限）
      note: clampText(note),
      audit: "",
      adjustmentType: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    invalidateMonthlyCacheForDate(now, user.userId);

    // Phase 1 shadow write：同步聚合 attendanceMonthly
    try {
      await applyEventToMonthly(user.userId, now);
    } catch (err) {
      console.error(
        `applyEventToMonthly 失敗 user=${user.userId} (punchWithoutLocation):`,
        err?.message
      );
    }

    return { ok: true, code: "PUNCH_SUCCESS_ADMIN", params: { type } };
  }
);
