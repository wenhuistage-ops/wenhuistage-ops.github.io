/**
 * checkSession — 驗證 sessionToken 並回傳員工資訊
 *
 * 對應 GS：Handlers.gs handleCheckSession + DbOperations.gs checkSession_
 *
 * 前端呼叫格式：
 *   callApifetch({ action: 'checkSession' })
 *   → httpsCallable(functions, 'checkSession')({ sessionToken })
 *
 * 回傳：
 *   成功：{ ok: true, user: { userId, name, picture, dept, ... } }
 *   失敗：{ ok: false, code: 'ERR_SESSION_INVALID' | ... }
 */

const { onCall } = require("firebase-functions/v2/https");
const { verifySession } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const result = await verifySession(sessionToken);

    if (!result.ok) {
      return { ok: false, code: result.code };
    }

    // 與 GS 版本格式對齊：不回傳完整 internal 欄位
    const { userId, name, displayName, picture, pictureUrl, dept } = result.user;
    return {
      ok: true,
      user: {
        userId,
        name: name || displayName || "",
        picture: picture || pictureUrl || "",
        dept: dept || "員工",
      },
    };
  }
);
