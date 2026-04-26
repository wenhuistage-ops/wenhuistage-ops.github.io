/**
 * getProfile — LINE code 換 user profile + session token
 *
 * 對應 GS：Handlers.gs handleGetProfile（呼叫 LineApi.gs 的 exchangeCodeForToken_、
 *        getLineUserInfo_、writeSession_、writeEmployee_）
 *
 * 前端呼叫：
 *   callApifetch({ action: 'getProfile', otoken: code, redirectUrl: '...' })
 *
 * 流程：
 *   1. LINE code → access_token + id_token
 *   2. 解 id_token 取 email、拉 /v2/profile 取 userId/displayName/pictureUrl
 *   3. upsert employees 文件（新員工預設未啟用）
 *   4. 產生 oneTimeToken（同 GS 流程，前端再 exchange 換 sessionToken）
 *
 * 回傳：
 *   成功：{ ok: true, code: "WELCOME_BACK", params: { name }, sToken: oneTimeToken }
 *   失敗：{ ok: false, code: "...", msg: "..." }
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  LINE_CHANNEL_ID,
  LINE_CHANNEL_SECRET,
  DEFAULT_LINE_REDIRECT_URL,
  upsertEmployee,
  createOneTimeToken,
} = require("./_helpers");

/**
 * 以 LINE authorization code 換 token
 */
async function exchangeCodeForToken(code, redirectUrl, channelId, channelSecret) {
  const url = "https://api.line.me/oauth2/v2.1/token";
  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUrl,
    client_id: channelId,
    client_secret: channelSecret,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
  });
  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(`LINE token 交換失敗: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * 取得 LINE 使用者 profile（/v2/profile + id_token decode）
 */
async function getLineUserInfo(tokenJson) {
  const profileResp = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profile = await profileResp.json();

  let email = "";
  if (tokenJson.id_token) {
    try {
      const parts = tokenJson.id_token.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), "=");
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const payload = JSON.parse(decoded);
        email = payload.email || "";
      }
    } catch (err) {
      console.warn("解析 id_token email 失敗:", err?.message);
    }
  }

  return {
    userId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    email,
  };
}

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
    secrets: [LINE_CHANNEL_ID, LINE_CHANNEL_SECRET],
  },
  async (request) => {
    const code = request.data?.otoken || request.data?.code;
    const redirectUrl = request.data?.redirectUrl || DEFAULT_LINE_REDIRECT_URL;

    if (!code) {
      return { ok: false, code: "ERR_MISSING_CODE" };
    }

    try {
      const tokenJson = await exchangeCodeForToken(
        code,
        redirectUrl,
        LINE_CHANNEL_ID.value(),
        LINE_CHANNEL_SECRET.value()
      );
      const profile = await getLineUserInfo(tokenJson);
      if (!profile.userId) {
        return { ok: false, code: "ERR_LINE_PROFILE_MISSING" };
      }

      await upsertEmployee(profile);
      const oneTimeToken = await createOneTimeToken(profile.userId);

      return {
        ok: true,
        code: "WELCOME_BACK",
        params: { name: profile.displayName || "" },
        sToken: oneTimeToken,
      };
    } catch (err) {
      console.error("getProfile 失敗:", err);
      return {
        ok: false,
        code: "ERR_LINE_AUTH_FAILED",
        msg: err?.message || String(err),
      };
    }
  }
);
