/**
 * approveReview — 核准審核（管理員專用）
 * 對應 GS：Handlers.gs handleApproveReview + DbOperations.gs updateReviewStatus
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
const APPROVED_TEXT = {
  "zh-TW": "✅ 您的{kind}申請（{date}）已核准。",
  vi: "✅ Đơn {kind} của bạn ({date}) đã được duyệt.",
  id: "✅ Pengajuan {kind} Anda ({date}) telah disetujui.",
  en: "✅ Your {kind} request ({date}) has been approved.",
  ja: "✅ あなたの{kind}申請（{date}）が承認されました。",
  ko: "✅ 귀하의 {kind} 신청({date})이 승인되었습니다.",
};
// 申請種類（補打卡 / 請假）各語系用字
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
        // B-L7：不得自審自批。管理員自己的補卡/請假要另一位管理員核准；
        // 若公司只有一位管理員，請改走 adjustPunch + updateAttendanceAsAdmin（留編輯軌跡）。
        if (d.userId && d.userId === auth.user.userId) {
          throw { _code: "ERR_CANNOT_SELF_APPROVE" };
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

    // U-M1：通知申請人「已核准」。fire-and-forget，失敗不影響審核結果。
    // 語言取 employees.preferredLanguage（checkSession 每次登入會同步）。
    (async () => {
      try {
        if (!data.userId) return;
        const empSnap = await db.collection(COLLECTIONS.EMPLOYEES).doc(data.userId).get();
        const lang = empSnap.data()?.preferredLanguage || "zh-TW";
        const kind = data.adjustmentType === "系統請假記錄" ? "leave" : "adjust";
        const msg = pick(APPROVED_TEXT, lang)
          .replace("{kind}", pick(KIND_TEXT[kind], lang))
          .replace("{date}", formatTaipei(punchDate).slice(0, 10));
        await sendLinePush(data.userId, msg, LINE_CHANNEL_ACCESS_TOKEN.value());
      } catch (err) {
        console.error("approveReview 通知申請人失敗:", err?.message);
      }
    })();

    return { ok: true, msg: "審核成功" };
  }
);
