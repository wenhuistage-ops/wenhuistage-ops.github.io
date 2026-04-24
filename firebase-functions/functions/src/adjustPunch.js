/**
 * adjustPunch — 補打卡申請
 * 對應 GS：Handlers.gs handleAdjustPunch + DbOperations.gs punchAdjusted
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifySession } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
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

    // TODO: 觸發管理員通知（異步通知系統實作後接入）

    return { ok: true, code: "ADJUST_PUNCH_SUCCESS", params: { type: type || "" } };
  }
);
