/**
 * exchangeToken — 用 oneTimeToken 換取 sessionToken
 *
 * 對應 GS：Handlers.gs handleExchangeToken + DbOperations.gs verifyOneTimeToken_
 *
 * 前端呼叫：
 *   callApifetch({ action: 'exchangeToken', otoken })
 *
 * 回傳：
 *   成功：{ ok: true, sToken: sessionToken }
 *   失敗：{ ok: false, code: "ERR_INVALID_TOKEN" }
 */

const { onCall } = require("firebase-functions/v2/https");
const { consumeOneTimeToken } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const otoken = request.data?.otoken;
    if (!otoken) {
      return { ok: false, code: "ERR_INVALID_TOKEN" };
    }

    const sessionToken = await consumeOneTimeToken(otoken);
    if (!sessionToken) {
      return { ok: false, code: "ERR_INVALID_TOKEN" };
    }

    return { ok: true, sToken: sessionToken };
  }
);
