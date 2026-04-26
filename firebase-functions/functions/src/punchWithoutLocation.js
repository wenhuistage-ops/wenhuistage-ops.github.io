/**
 * punchWithoutLocation — 管理員無定位打卡
 * 對應 GS：Handlers.gs handlePunchWithoutLocation
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifyAdmin } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { type, note } = request.data || {};

    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    if (!["上班", "下班"].includes(type)) {
      return { ok: false, code: "ERR_INVALID_PUNCH_TYPE" };
    }

    const user = auth.user;
    const now = new Date();
    await db.collection(COLLECTIONS.ATTENDANCE).add({
      timestamp: admin.firestore.Timestamp.fromDate(now),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type,
      coords: "無定位",
      locationName: "管理員手動授權",
      note: note || "",
      audit: "",
      adjustmentType: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, code: "PUNCH_SUCCESS_ADMIN", params: { type } };
  }
);
