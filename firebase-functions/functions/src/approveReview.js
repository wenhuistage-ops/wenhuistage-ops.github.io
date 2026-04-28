/**
 * approveReview — 核准審核（管理員專用）
 * 對應 GS：Handlers.gs handleApproveReview + DbOperations.gs updateReviewStatus
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifyAdmin } = require("./_helpers");
const { invalidateMonthlyCacheForDate } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const id = request.data?.id;
    if (!id) return { ok: false, msg: "缺少審核 ID" };

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, msg: "記錄不存在" };
    const data = snap.data();

    await ref.update({
      audit: "v",
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: auth.user.userId,
    });
    // audit 變動會影響該月 dailyStatus reason，清月度快取
    const punchDate = data.timestamp?.toDate?.() || data.timestamp;
    if (punchDate) invalidateMonthlyCacheForDate(punchDate, data.userId);

    return { ok: true, msg: "審核成功" };
  }
);
