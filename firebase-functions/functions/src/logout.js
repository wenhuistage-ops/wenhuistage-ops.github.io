/**
 * logout — 撤銷目前的 sessionToken（真正登出）
 *
 * 前端呼叫：callApifetch({ action: 'logout' })
 *
 * 在此之前「登出」只清瀏覽器 localStorage，伺服器端 session 仍有效 30 天；
 * 此 action 刪除 sessions/{token}，之後同一 token 一律 ERR_SESSION_INVALID。
 * token 缺少 / 不存在也回 ok（冪等），前端不論結果都會清本機狀態。
 */

const { onCall } = require("firebase-functions/v2/https");
const { revokeSession } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || null;
    try {
      await revokeSession(sessionToken);
      return { ok: true };
    } catch (err) {
      console.error("logout 撤銷 session 失敗:", err);
      return { ok: false, code: "ERR_LOGOUT_FAILED" };
    }
  }
);
