/**
 * rejectReview — 拒絕審核（管理員專用）
 * 對應 GS：Handlers.gs handleRejectReview + DbOperations.gs updateReviewStatus
 *
 * 狀態機、聚合重算、通知申請人都在 _review.js（與 lineWebhook 的 LINE 卡片按鈕共用）。
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifyAdmin, isValidDocId, LINE_CHANNEL_ACCESS_TOKEN, CORS_ORIGINS } = require("./_helpers");
const { reviewRequest } = require("./_review");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: CORS_ORIGINS,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const id = request.data?.id;
    if (!id) return { ok: false, msg: "缺少審核 ID" };
    // B-L9：docId 未驗字元就 .doc()，含 '/' 直接 500
    if (!isValidDocId(id)) return { ok: false, code: "ERR_MISSING_ID", msg: "審核 ID 格式不正確" };

    // 退回原因（可選）：讓員工在「我的申請」看到為何被退。上限 500 字。
    const reason = String(request.data?.reason || "").trim().slice(0, 500);

    const res = await reviewRequest({
      id,
      decision: "reject",
      reviewerId: auth.user.userId,
      reason,
      accessToken: LINE_CHANNEL_ACCESS_TOKEN.value(),
    });
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, msg: "審核成功" };
  }
);
