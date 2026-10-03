/**
 * 審核共用核心
 *
 * approveReview / rejectReview（網頁按鈕）與 lineWebhook（LINE 卡片按鈕）共用同一套
 * 狀態機與副作用，避免兩條路徑規則分岔（例如一邊擋自審自批、一邊漏擋）。
 */

const { admin, db, COLLECTIONS, sendLinePush, formatTaipei } = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

// U-M1：審核結果通知員工。多語字典寫法比照 checkYesterdayPunch.js 的 BROADCAST_TEXT。
// {kind}=補打卡/請假、{date}=目標日期（台北時區）
const RESULT_TEXT = {
  approve: {
    "zh-TW": "✅ 您的{kind}申請（{date}）已核准。",
    vi: "✅ Đơn {kind} của bạn ({date}) đã được duyệt.",
    id: "✅ Pengajuan {kind} Anda ({date}) telah disetujui.",
    en: "✅ Your {kind} request ({date}) has been approved.",
    ja: "✅ あなたの{kind}申請（{date}）が承認されました。",
    ko: "✅ 귀하의 {kind} 신청({date})이 승인되었습니다.",
  },
  reject: {
    "zh-TW": "❌ 您的{kind}申請（{date}）已被退回。",
    vi: "❌ Đơn {kind} của bạn ({date}) đã bị từ chối.",
    id: "❌ Pengajuan {kind} Anda ({date}) ditolak.",
    en: "❌ Your {kind} request ({date}) was rejected.",
    ja: "❌ あなたの{kind}申請（{date}）は差し戻されました。",
    ko: "❌ 귀하의 {kind} 신청({date})이 반려되었습니다.",
  },
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

/**
 * 核准 / 退回一筆待審的補打卡或請假。
 *
 * @param {object} p
 * @param {string} p.id                attendance doc id（呼叫端須先 isValidDocId）
 * @param {"approve"|"reject"} p.decision
 * @param {string} p.reviewerId        管理員 userId（呼叫端須先確認是管理員）
 * @param {string} [p.reason]          退回原因（只用於 reject）
 * @param {number} [p.expectedTsMillis] LINE 卡片上顯示的補卡時間；與現況不同代表
 *                                     員工送出後又改過 → 拒絕，避免照舊卡片核准到新時間
 * @param {string} p.accessToken       LINE_CHANNEL_ACCESS_TOKEN.value()
 * @returns {Promise<{ok:true, data:Object, punchDate:Date}|{ok:false, code:string}>}
 */
async function reviewRequest({ id, decision, reviewerId, reason = "", expectedTsMillis, accessToken }) {
  const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
  // transaction 包 read+檢查+write，避免 approve/reject 並發時後寫覆蓋；
  // 狀態機：只允許審核「待審核（?）」的補卡/請假，防止復活已拒申請、
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
      if (d.userId && d.userId === reviewerId) {
        throw { _code: "ERR_CANNOT_SELF_APPROVE" };
      }
      if (expectedTsMillis != null && d.timestamp?.toMillis?.() !== expectedTsMillis) {
        throw { _code: "ERR_REQUEST_CHANGED" };
      }
      tx.update(ref, {
        audit: decision === "approve" ? "v" : "x",
        ...(decision === "reject" ? { rejectReason: reason } : {}),
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: reviewerId,
      });
      return d;
    });
  } catch (e) {
    if (e && e._code) return { ok: false, code: e._code };
    throw e;
  }

  // audit 變動會影響該日 reason（如 STATUS_REPAIR_APPROVED），清快取並重算聚合
  const punchDate = data.timestamp?.toDate?.() || data.timestamp;
  if (punchDate && data.userId) {
    invalidateMonthlyCacheForDate(punchDate, data.userId);
    try {
      await applyEventToMonthly(data.userId, punchDate);
    } catch (err) {
      console.error(`applyEventToMonthly 失敗 user=${data.userId} (review ${decision}):`, err?.message);
    }
  }

  // U-M1：通知申請人結果。失敗不影響審核結果。
  // 語言取 employees.preferredLanguage（checkSession 每次登入會同步）。
  try {
    if (data.userId) {
      const empSnap = await db.collection(COLLECTIONS.EMPLOYEES).doc(data.userId).get();
      const lang = empSnap.data()?.preferredLanguage || "zh-TW";
      const kind = data.adjustmentType === "系統請假記錄" ? "leave" : "adjust";
      let msg = pick(RESULT_TEXT[decision], lang)
        .replace("{kind}", pick(KIND_TEXT[kind], lang))
        .replace("{date}", formatTaipei(punchDate).slice(0, 10));
      if (decision === "reject" && reason) msg += `\n${pick(REASON_LABEL, lang)}：${reason}`;
      await sendLinePush(data.userId, msg, accessToken);
    }
  } catch (err) {
    console.error(`review ${decision} 通知申請人失敗:`, err?.message);
  }

  return { ok: true, data, punchDate };
}

/** Flex 卡片的一列「標籤：值」（LINE 不收空字串 text，空值顯示 —） */
function _row(label, value) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: String(value || "—"), size: "sm", wrap: true, flex: 5 },
    ],
  };
}

/**
 * 補打卡申請的 LINE Flex 卡片（給管理員，按鈕直接核准 / 退回 → lineWebhook）
 *
 * postback data 帶 ts（補卡時間毫秒）：員工改過申請後舊卡片的 ts 對不上，
 * reviewRequest 會回 ERR_REQUEST_CHANGED，不會照舊內容核准到新時間。
 */
function buildAdjustReviewCard({ id, name, dept, type, punchDate, applicationTime, note, edited }) {
  const ts = punchDate.getTime();
  const who = name || "員工";
  const btn = (decision, label, style) => ({
    type: "button",
    style,
    height: "sm",
    action: {
      type: "postback",
      label,
      data: `review=${decision}&id=${id}&ts=${ts}`,
      displayText: `${label} ${who} 的補打卡`,
    },
  });
  return {
    type: "flex",
    altText: `${edited ? "✏️ 補打卡申請已修改" : "🕒 新補打卡申請"}：${who} ${type} ${formatTaipei(punchDate)}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: edited ? "✏️ 補打卡申請已修改" : "🕒 新補打卡申請", weight: "bold", size: "lg" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          _row("申請人", name),
          _row("部門", dept || "未設定"),
          _row("類型", type),
          _row("補卡時間", formatTaipei(punchDate)),
          _row("申請時間", formatTaipei(applicationTime)),
          ...(note ? [_row("備註", note)] : []),
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [btn("reject", "退回", "secondary"), btn("approve", "核准", "primary")],
      },
    },
  };
}

module.exports = { reviewRequest, buildAdjustReviewCard };
