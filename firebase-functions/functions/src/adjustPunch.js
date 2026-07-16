/**
 * adjustPunch — 補打卡申請
 * 對應 GS：Handlers.gs handleAdjustPunch + DbOperations.gs punchAdjusted
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifySession,
  clampText,
  validateCoordinates,
  isReasonableAttendanceDate,
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
    const { type, lat, lng, note, datetime } = request.data || {};

    // type 白名單：員工端補打卡只能是上下班，不得偽造 '請假'/'休假' 類型紀錄
    if (!["上班", "下班"].includes(type)) {
      return { ok: false, code: "ERR_INVALID_PUNCH_TYPE" };
    }

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const user = session.user;
    const punchDate = datetime ? new Date(datetime) : new Date();
    if (!isReasonableAttendanceDate(punchDate)) {
      return { ok: false, code: "ERR_INVALID_DATETIME" };
    }

    // 補打卡座標僅供記錄（不做地理圍欄），但仍須驗證避免 NaN/Infinity 汙染紀錄
    let vLat = null;
    let vLng = null;
    if (lat !== undefined && lng !== undefined) {
      const v = validateCoordinates(lat, lng);
      if (v.valid) {
        vLat = v.lat;
        vLng = v.lng;
      }
    }

    const applicationTime = new Date();
    // 2026-05-15：在 note 加 [員工補卡] prefix，UI / Firestore Console 一眼能識別來源
    const noteWithTag = note
      ? `[員工補卡] ${clampText(note)}`
      : "[員工補卡]";
    await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type,
      lat: vLat,
      lng: vLng,
      coords: `申請時間: ${applicationTime.toISOString()}`,
      locationName: "", // 補打卡不填地點
      note: noteWithTag,
      audit: "?", // 待審核
      adjustmentType: "補打卡",
      applicationTime: admin.firestore.Timestamp.fromDate(applicationTime),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    invalidateMonthlyCacheForDate(punchDate, user.userId);

    // Phase 1 shadow write：同步聚合 attendanceMonthly（補打卡的目標日期所在月）
    try {
      await applyEventToMonthly(user.userId, punchDate);
    } catch (err) {
      console.error(
        `applyEventToMonthly 失敗 user=${user.userId} (adjustPunch):`,
        err?.message
      );
    }

    // 異步通知管理員（fire-and-forget）
    const notifMsg =
      `🕒 新補打卡申請\n` +
      `👤 申請人：${user.name || ""}\n` +
      `📝 類型：補打卡（${type || ""}）\n` +
      `📅 補打卡時間：${formatTaipei(punchDate)}\n` +
      `🕒 申請時間：${formatTaipei(applicationTime)}\n` +
      `📍 部門：${user.dept || "未設定"}` +
      (note ? `\n📋 備註：${note}` : "");
    notifyAdmins(notifMsg, LINE_CHANNEL_ACCESS_TOKEN.value()).catch((err) =>
      console.error("adjustPunch notifyAdmins 失敗:", err)
    );

    return { ok: true, code: "ADJUST_PUNCH_SUCCESS", params: { type: type || "" } };
  }
);
