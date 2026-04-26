/**
 * getBreakTimes — 讀取公司休息時段設定
 *
 * 結構：settings/breakTimes
 *   { breaks: [{ name, start, end }, ...] }
 *
 * 任何已登入 session 皆可讀（員工也需知道休息時間以正確顯示工時）。
 * 若 document 不存在，回傳預設三餐時段。
 */

const { onCall } = require("firebase-functions/v2/https");
const { db, verifySession } = require("./_helpers");

const DEFAULT_BREAKS = [
  { name: "早餐", start: "06:00", end: "06:30" },
  { name: "午餐", start: "12:00", end: "13:00" },
  { name: "晚餐", start: "19:00", end: "19:30" },
];

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const ref = db.collection("settings").doc("breakTimes");
    const snap = await ref.get();
    if (!snap.exists) {
      return { ok: true, breaks: DEFAULT_BREAKS };
    }
    const data = snap.data() || {};
    const breaks = Array.isArray(data.breaks) ? data.breaks : DEFAULT_BREAKS;
    return { ok: true, breaks };
  }
);
