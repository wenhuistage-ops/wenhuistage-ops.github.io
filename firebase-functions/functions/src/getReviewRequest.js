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
const { db, COLLECTIONS, verifyAdmin, verifySession, formatTaipei } = require("./_helpers");

const VALID_AUDIT = new Set(["?", "v", "x", "all"]);

// 預設只看「最近 90 天」的審核紀錄。舊紀錄極少需要重新查（多半已歸檔到
// Excel 月報），不該每次 API call 都掃到。可由 request.data.daysBack 覆寫。
const DEFAULT_DAYS_BACK = 90;
const MAX_DAYS_BACK = 365;

// 預設 limit 從 200 降到 50。實務上每月新增的待審記錄 < 20 筆，超過 50
// 通常代表 admin 在看歷史已核准/拒絕——這時 admin 自己會調 limit。
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;

    // 員工查自己的審核紀錄 → 用 verifySession（一般員工）；查全公司 → verifyAdmin
    const requestedUserId = String(request.data?.userId || "").trim();
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    // 沒指定 userId 等於要看全公司 → 必須是 admin
    if (!requestedUserId && session.user.dept !== "管理員") {
      return { ok: false, code: "ERR_NO_PERMISSION" };
    }
    // 指定 userId 但不是自己 → 必須是 admin
    if (requestedUserId && requestedUserId !== session.user.userId && session.user.dept !== "管理員") {
      return { ok: false, code: "ERR_NO_PERMISSION" };
    }

    const auditRaw = request.data?.audit;
    const audit = VALID_AUDIT.has(auditRaw) ? auditRaw : "?";
    const limit = Math.min(Math.max(Number(request.data?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const daysBack = Math.min(
      Math.max(Number(request.data?.daysBack) || DEFAULT_DAYS_BACK, 1),
      MAX_DAYS_BACK
    );

    // 計算「N 天前的午夜」為時間下界
    const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    let q = db
      .collection(COLLECTIONS.ATTENDANCE)
      .where("timestamp", ">=", sinceDate);
    if (audit !== "all") q = q.where("audit", "==", audit);
    if (requestedUserId) q = q.where("userId", "==", requestedUserId);
    q = q.orderBy("timestamp", "desc").limit(limit);

    const snap = await q.get();

    // 讀取監測 log：方便辨識「200 limit + 無時間範圍」型的熱點
    console.log(
      `[reads] getReviewRequest u=${requestedUserId ? requestedUserId.slice(0, 8) : 'ALL'} ` +
        `audit=${audit} daysBack=${daysBack} limit=${limit} reads=${snap.size}`
    );

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
          // 明確標示種類，前端不必再靠 remark 字串猜（補打卡 vs 請假/休假）
          kind: isLeave ? "leave" : "adjust",
          adjustmentType: adjustmentType,
          remark: isLeave ? d.reason || d.locationName || "" : adjustmentType,
          note: d.note || "", // 備註（假單說明等），供員工端顯示
          rejectReason: d.rejectReason || "", // 退回原因（audit==='x' 時顯示給員工）
          applicationTime: formatTaipei(applicationTime),
          targetTime: formatTaipei(punchDate),
          // 申請目標日（YYYY-MM-DD，台北時區）：前端異常列表用來比對「該日已有申請
          // 審核中」，缺這個欄位會使審核中徽章永遠不顯示（員工誤以為失敗重複申請）
          date: formatTaipei(punchDate).slice(0, 10),
          audit: d.audit || "?", // Phase 4：給前端 tab 分群用
          // 2026-06-10：病假證明照片旗標（只帶 boolean，照片本體由 getLeaveProof 按需取）
          hasProof: !!d.proofPhoto,
        };
      })
      .filter(Boolean);

    return { ok: true, reviewRequest };
  }
);
