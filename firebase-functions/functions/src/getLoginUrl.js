/**
 * getLoginUrl — 產生 LINE OAuth 授權 URL
 *
 * 對應 GS：Handlers.gs handleGetLoginUrl
 *
 * 前端呼叫：
 *   callApifetch({ action: 'getLoginUrl', redirectUrl: '...' })
 *
 * 回傳：{ url: "https://access.line.me/oauth2/v2.1/authorize?..." }
 */

const crypto = require("crypto");
const { onCall } = require("firebase-functions/v2/https");
const { LINE_CHANNEL_ID, DEFAULT_LINE_REDIRECT_URL } = require("./_helpers");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
    secrets: [LINE_CHANNEL_ID],
  },
  async (request) => {
    const redirectUrl = request.data?.redirectUrl || DEFAULT_LINE_REDIRECT_URL;
    const state = crypto.randomUUID();
    const scope = encodeURIComponent("openid profile email");
    const redirect = encodeURIComponent(redirectUrl);
    const clientId = encodeURIComponent(LINE_CHANNEL_ID.value());

    const url =
      `https://access.line.me/oauth2/v2.1/authorize?response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${redirect}` +
      `&state=${state}` +
      `&scope=${scope}`;

    console.log("getLoginUrl: 使用的 redirectUrl =", redirectUrl);
    return { url };
  }
);
