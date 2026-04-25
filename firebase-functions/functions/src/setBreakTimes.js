/**
 * setBreakTimes — 寫入公司休息時段設定（管理員專用）
 *
 * 前端傳入 breaks 陣列：[{ name, start, end }, ...]
 *
 * 驗證：
 * - 每筆需有 name 字串、start/end 為 'HH:MM' 格式
 * - end 必須晚於 start（同一天內）
 * - 最多 10 筆，避免亂塞
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, verifyAdmin } = require("./_helpers");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function _toMin(hhmm) {
  const m = TIME_RE.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const breaks = request.data?.breaks;
    if (!Array.isArray(breaks)) {
      return { ok: false, code: "ERR_INVALID_INPUT", msg: "breaks must be an array" };
    }
    if (breaks.length > 10) {
      return { ok: false, code: "ERR_TOO_MANY_BREAKS", msg: "max 10 breaks" };
    }

    const cleaned = [];
    for (const b of breaks) {
      const name = String(b?.name || "").trim();
      const start = String(b?.start || "").trim();
      const end = String(b?.end || "").trim();
      if (!name) return { ok: false, code: "ERR_BREAK_NAME_EMPTY", msg: "name required" };
      const sMin = _toMin(start);
      const eMin = _toMin(end);
      if (sMin == null || eMin == null) {
        return { ok: false, code: "ERR_BREAK_TIME_FORMAT", msg: "start/end must be HH:MM" };
      }
      if (eMin <= sMin) {
        return { ok: false, code: "ERR_BREAK_TIME_ORDER", msg: "end must be later than start" };
      }
      cleaned.push({ name, start, end });
    }

    await db.collection("settings").doc("breakTimes").set(
      {
        breaks: cleaned,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.user?.userId || "",
      },
      { merge: true }
    );

    return { ok: true, breaks: cleaned };
  }
);
