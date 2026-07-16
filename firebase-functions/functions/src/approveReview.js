/**
 * approveReview — 核准審核（管理員專用）
 * 對應 GS：Handlers.gs handleApproveReview + DbOperations.gs updateReviewStatus
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

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    // 用 transaction 包 read+檢查+write，避免 approve/reject 並發時後寫覆蓋；
    // 並加狀態機：只允許審核「待審核（?）」的補卡/請假，防止復活已拒申請、
    // 重複核准、或把一般打卡/系統虛擬卡硬改 audit（那些應走 updateAttendanceAsAdmin）。
    let data;
    try {
      data = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw { _code: "ERR_NOT_FOUND" };
        const d = snap.data();
        if (d.audit !== "?") throw { _code: "ERR_ALREADY_REVIEWED" };
        if (d.adjustmentType !== "補打卡" && d.adjustmentType !== "系統請假記錄") {
          throw { _code: "ERR_NOT_REVIEWABLE" };
        }
        tx.update(ref, {
          audit: "v",
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: auth.user.userId,
        });
        return d;
      });
    } catch (e) {
      if (e && e._code) return { ok: false, code: e._code };
      throw e;
    }
    // audit 變動會影響該月 dailyStatus reason，清月度快取
    const punchDate = data.timestamp?.toDate?.() || data.timestamp;
    if (punchDate) invalidateMonthlyCacheForDate(punchDate, data.userId);

    // Phase 1 shadow write：審核通過會改變該日 reason（如 STATUS_LEAVE_APPROVED）
    if (punchDate && data.userId) {
      try {
        await applyEventToMonthly(data.userId, punchDate);
      } catch (err) {
        console.error(
          `applyEventToMonthly 失敗 user=${data.userId} (approveReview):`,
          err?.message
        );
      }
    }

    return { ok: true, msg: "審核成功" };
  }
);
