/**
 * submitLeave — 員工提交請假 / 休假申請
 * 對應 GS：Handlers.gs handleSubmitLeave
 *
 * 資料模型：寫入 attendance 集合（audit='?'、adjustmentType='系統請假記錄'）
 * 通知：TODO 對接異步通知佇列後觸發
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
const { invalidateMonthlyCacheForDate } = require("./_attendance");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { date, type, reason, note } = request.data || {};

    if (!date || !type || !reason) {
      return { ok: false, code: "ERR_MISSING_PARAMS", msg: "缺少必要參數" };
    }

    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: "ERR_INVALID_SESSION" };

    const user = session.user;
    const punchDate = new Date(date);
    if (isNaN(punchDate.getTime())) {
      return { ok: false, code: "ERR_INVALID_DATE" };
    }

    const applicationTime = new Date();
    const typeText = type === "leave" ? "請假" : "休假";

    const ref = await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type: typeText,
      coords: `申請時間: ${applicationTime.toISOString()}`,
      locationName: reason, // GS 版把原因存在地點欄位；此處欄位同
      reason,
      note: note || "",
      audit: "?",
      adjustmentType: "系統請假記錄",
      applicationTime: admin.firestore.Timestamp.fromDate(applicationTime),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    invalidateMonthlyCacheForDate(punchDate, user.userId);

    // 異步通知管理員（fire-and-forget，不 await）
    const notifMsg =
      `📋 新${typeText}申請\n` +
      `👤 申請人：${user.name || ""}\n` +
      `📅 日期：${date}\n` +
      `📝 原因：${reason}\n` +
      (note ? `📋 備註：${note}\n` : "") +
      `🕒 申請時間：${applicationTime.toISOString()}`;
    notifyAdmins(notifMsg, LINE_CHANNEL_ACCESS_TOKEN.value()).catch((err) =>
      console.error("submitLeave notifyAdmins 失敗:", err)
    );

    return {
      ok: true,
      msg: typeText === "請假" ? "請假申請已提交" : "休假申請已提交",
      id: ref.id,
    };
  }
);
