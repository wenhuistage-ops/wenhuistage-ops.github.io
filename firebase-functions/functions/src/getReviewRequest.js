/**
 * getReviewRequest — 取得申請審核紀錄（管理員專用）
 * 對應 GS：Handlers.gs handleGetReviewRequest + DbOperations.gs getReviewRequest
 *
 * Phase 4 擴充：可篩選單一員工 + 不同審核狀態
 *   request.data:
 *     userId?: string          指定員工 ID；未傳 = 全公司
 *     audit?:  '?' | 'v' | 'x' | 'all'  審核狀態；預設 '?' (待審核)，向後相容
 *     limit?:  number          上限；預設 200，最大 500
 *
 * 回傳 item 加 audit 欄位，方便前端 tab 分群顯示。
 */

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifyAdmin, formatTaipei } = require("./_helpers");

const VALID_AUDIT = new Set(["?", "v", "x", "all"]);

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const userId = String(request.data?.userId || "").trim();
    const auditRaw = request.data?.audit;
    const audit = VALID_AUDIT.has(auditRaw) ? auditRaw : "?";
    const limit = Math.min(Math.max(Number(request.data?.limit) || 200, 1), 500);

    let q = db.collection(COLLECTIONS.ATTENDANCE);
    if (audit !== "all") q = q.where("audit", "==", audit);
    if (userId) q = q.where("userId", "==", userId);
    q = q.orderBy("timestamp", "desc").limit(limit);

    const snap = await q.get();

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
          userId: d.userId || "",
          name: d.name || "",
          type: d.type || "",
          remark: isLeave ? d.reason || d.locationName || "" : adjustmentType,
          applicationTime: formatTaipei(applicationTime),
          targetTime: formatTaipei(punchDate),
          audit: d.audit || "?", // Phase 4：給前端 tab 分群用
        };
      })
      .filter(Boolean);

    return { ok: true, reviewRequest };
  }
);
