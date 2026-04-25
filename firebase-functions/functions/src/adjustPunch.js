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
  notifyAdmins,
  LINE_CHANNEL_ACCESS_TOKEN,
} = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { type, lat, lng, note, datetime } = request.data || {};

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const user = session.user;
    const punchDate = datetime ? new Date(datetime) : new Date();
    if (isNaN(punchDate.getTime())) {
      return { ok: false, code: "ERR_INVALID_DATETIME" };
    }

    const applicationTime = new Date();
    await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type: type || "",
      lat: lat !== undefined ? Number(lat) : null,
      lng: lng !== undefined ? Number(lng) : null,
      coords: `申請時間: ${applicationTime.toISOString()}`,
      locationName: "", // 補打卡不填地點
      note: note || "",
      audit: "?", // 待審核
      adjustmentType: "補打卡",
      applicationTime: admin.firestore.Timestamp.fromDate(applicationTime),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 異步通知管理員（fire-and-forget）
    const fmt = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      const h = String(dt.getHours()).padStart(2, "0");
      const mi = String(dt.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${d} ${h}:${mi}`;
    };
    const notifMsg =
      `🕒 新補打卡申請\n` +
      `👤 申請人：${user.name || ""}\n` +
      `📝 類型：補打卡（${type || ""}）\n` +
      `📅 補打卡時間：${fmt(punchDate)}\n` +
      `🕒 申請時間：${fmt(applicationTime)}\n` +
      `📍 部門：${user.dept || "未設定"}` +
      (note ? `\n📋 備註：${note}` : "");
    notifyAdmins(notifMsg, LINE_CHANNEL_ACCESS_TOKEN.value()).catch((err) =>
      console.error("adjustPunch notifyAdmins 失敗:", err)
    );

    return { ok: true, code: "ADJUST_PUNCH_SUCCESS", params: { type: type || "" } };
  }
);
