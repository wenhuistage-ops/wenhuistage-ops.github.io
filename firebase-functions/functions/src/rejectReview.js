/**
 * rejectReview — 拒絕審核（管理員專用）
 * 對應 GS：Handlers.gs handleRejectReview + DbOperations.gs updateReviewStatus
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, COLLECTIONS, verifyAdmin } = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const id = request.data?.id;
    if (!id) return { ok: false, msg: "缺少審核 ID" };

    // 退回原因（可選）：讓員工在「我的申請」看到為何被退。上限 500 字。
    const rejectReason = String(request.data?.reason || "").trim().slice(0, 500);

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, msg: "記錄不存在" };
    const data = snap.data();

    await ref.update({
      audit: "x",
      rejectReason: rejectReason,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: auth.user.userId,
    });
    const punchDate = data.timestamp?.toDate?.() || data.timestamp;
    if (punchDate) invalidateMonthlyCacheForDate(punchDate, data.userId);

    // Phase 1 shadow write：拒絕會改變該日 reason（譬如把 LEAVE_PENDING 移除）
    if (punchDate && data.userId) {
      try {
        await applyEventToMonthly(data.userId, punchDate);
      } catch (err) {
        console.error(
          `applyEventToMonthly 失敗 user=${data.userId} (rejectReview):`,
          err?.message
        );
      }
    }

    return { ok: true, msg: "審核成功" };
  }
);
