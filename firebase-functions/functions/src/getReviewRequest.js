/**
 * getReviewRequest — 取得待審核申請清單（管理員專用）
 * 對應 GS：Handlers.gs handleGetReviewRequest + DbOperations.gs getReviewRequest
 */

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifyAdmin, formatTaipei } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const snap = await db
      .collection(COLLECTIONS.ATTENDANCE)
      .where("audit", "==", "?")
      .orderBy("timestamp", "desc")
      .limit(200) // 防止大量資料
      .get();

    const reviewRequest = snap.docs
      .map((doc) => {
        const d = doc.data();
        const adjustmentType = d.adjustmentType || "";
        const isLeave = adjustmentType === "系統請假記錄";
        const isAdjust = adjustmentType === "補打卡";
        if (!isLeave && !isAdjust) return null;

        const punchDate = d.timestamp?.toDate?.() || null;
        const applicationTime = d.applicationTime?.toDate?.() || null;

        return {
          id: doc.id, // Firestore 用 docId 取代 GS 的 rowNumber
          name: d.name || "",
          type: d.type || "",
          remark: isLeave ? d.reason || d.locationName || "" : adjustmentType,
          applicationTime: formatTaipei(applicationTime),
          targetTime: formatTaipei(punchDate),
        };
      })
      .filter(Boolean);

    return { ok: true, reviewRequest };
  }
);
