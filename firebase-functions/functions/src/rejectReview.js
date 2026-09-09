/**
 * rejectReview — 拒絕審核（管理員專用）
 * 對應 GS：Handlers.gs handleRejectReview + DbOperations.gs updateReviewStatus
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifyAdmin,
  isValidDocId,
  sendLinePush,
  formatTaipei,
  LINE_CHANNEL_ACCESS_TOKEN,
  CORS_ORIGINS,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

// U-M1：審核結果通知員工。多語字典寫法比照 checkYesterdayPunch.js 的 BROADCAST_TEXT。
// {kind}=補打卡/請假、{date}=目標日期（台北時區）
const REJECTED_TEXT = {
  "zh-TW": "❌ 您的{kind}申請（{date}）已被退回。",
  vi: "❌ Đơn {kind} của bạn ({date}) đã bị từ chối.",
  id: "❌ Pengajuan {kind} Anda ({date}) ditolak.",
  en: "❌ Your {kind} request ({date}) was rejected.",
  ja: "❌ あなたの{kind}申請（{date}）は差し戻されました。",
  ko: "❌ 귀하의 {kind} 신청({date})이 반려되었습니다.",
};
// 退回原因前綴（有填 reason 時才附上）
const REASON_LABEL = {
  "zh-TW": "退回原因",
  vi: "Lý do",
  id: "Alasan",
  en: "Reason",
  ja: "理由",
  ko: "사유",
};
const KIND_TEXT = {
  adjust: {
    "zh-TW": "補打卡",
    vi: "bổ sung chấm công",
    id: "koreksi absensi",
    en: "punch correction",
    ja: "打刻修正",
    ko: "출퇴근 정정",
  },
  leave: {
    "zh-TW": "請假",
    vi: "nghỉ phép",
    id: "izin/cuti",
    en: "leave",
    ja: "休暇",
    ko: "휴가",
  },
};

function pick(dict, lang) {
  return dict[lang] || dict[String(lang || "").split("-")[0]] || dict["zh-TW"];
}

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
    const rejectReason = String(request.data?.reason || "").trim().slice(0, 500);

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    // 同 approveReview：transaction + 狀態機，只允許退回「待審核（?）」的補卡/請假，
    // 避免並發覆寫、重複退回、或把非審核類紀錄硬改 audit。
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
        // B-L7：不得自審自批（同 approveReview）
        if (d.userId && d.userId === auth.user.userId) {
          throw { _code: "ERR_CANNOT_SELF_APPROVE" };
        }
        tx.update(ref, {
          audit: "x",
          rejectReason: rejectReason,
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: auth.user.userId,
        });
        return d;
      });
    } catch (e) {
      if (e && e._code) return { ok: false, code: e._code };
      throw e;
    }
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

    // U-M1：通知申請人「已退回」＋原因。fire-and-forget，失敗不影響審核結果。
    (async () => {
      try {
        if (!data.userId) return;
        const empSnap = await db.collection(COLLECTIONS.EMPLOYEES).doc(data.userId).get();
        const lang = empSnap.data()?.preferredLanguage || "zh-TW";
        const kind = data.adjustmentType === "系統請假記錄" ? "leave" : "adjust";
        let msg = pick(REJECTED_TEXT, lang)
          .replace("{kind}", pick(KIND_TEXT[kind], lang))
          .replace("{date}", formatTaipei(punchDate).slice(0, 10));
        if (rejectReason) msg += `\n${pick(REASON_LABEL, lang)}：${rejectReason}`;
        await sendLinePush(data.userId, msg, LINE_CHANNEL_ACCESS_TOKEN.value());
      } catch (err) {
        console.error("rejectReview 通知申請人失敗:", err?.message);
      }
    })();

    return { ok: true, msg: "審核成功" };
  }
);
