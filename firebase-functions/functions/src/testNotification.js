/**
 * testNotification — 測試管理員 LINE 通知（管理員專用）
 * 對應 GS：Handlers.gs handleTestNotification
 *
 * 前端呼叫：
 *   callApifetch({ action: 'testNotification' })
 *
 * 行為：對所有 dept='管理員' 的員工發送一則測試訊息，回傳成功/失敗計數
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  verifyAdmin,
  notifyAdmins,
  getAdminList,
  LINE_CHANNEL_ACCESS_TOKEN,
} = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const admins = await getAdminList();
    const now = new Date();
    const fmt = (dt) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ` +
      `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:${String(dt.getSeconds()).padStart(2, "0")}`;
    const message =
      `🧪 測試通知（Cloud Functions）\n` +
      `📅 ${fmt(now)}\n` +
      `👥 管理員數量：${admins.length}\n` +
      `🚀 來自 wenhui-check-in-system`;

    const result = await notifyAdmins(message, LINE_CHANNEL_ACCESS_TOKEN.value());
    return {
      ok: result.ok,
      msg: result.ok ? "測試通知發送成功" : "測試通知發送失敗",
      adminCount: admins.length,
      result,
    };
  }
);
