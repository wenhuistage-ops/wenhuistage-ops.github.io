/**
 * getLoginUrl — 產生 LINE OAuth 授權 URL
 *
 * 對應 GS：Handlers.gs handleGetLoginUrl
 *
 * 前端呼叫：
 *   callApifetch({ action: 'getLoginUrl', redirectUrl: '...' })
 *
 * 回傳：{ url: "https://access.line.me/oauth2/v2.1/authorize?...", state: "<uuid>" }
 *
 * 2026-06-10 CSRF 防護：state 隨 url 一併回傳，前端存 sessionStorage，
 * OAuth callback 時比對 query string 的 state 與 sessionStorage 是否一致，
 * 不一致代表 authorization code 不是本瀏覽器發起的授權（login CSRF），拒絕。
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
    return { url, state };
  }
);
