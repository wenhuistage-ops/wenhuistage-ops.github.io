/**
 * submitLeave — 員工提交請假 / 休假申請
 * 對應 GS：Handlers.gs handleSubmitLeave
 *
 * 資料模型：寫入 attendance 集合（audit='?'、adjustmentType='系統請假記錄'）
 * 通知：TODO 對接異步通知佇列後觸發
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifySession } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
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

    // TODO: 觸發 notifyAdmins（異步通知佇列）

    return {
      ok: true,
      msg: typeText === "請假" ? "請假申請已提交" : "休假申請已提交",
      id: ref.id,
    };
  }
);
