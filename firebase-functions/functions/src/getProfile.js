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
  safeRedirectUrl,
  consumeOAuthState,
  upsertEmployee,
  createOneTimeToken,
  CORS_ORIGINS,
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
  // ⚠️ L1：此處只 base64 解 id_token payload、未驗 RS256 簽章/iss/aud/exp。
  // 之所以可接受：id_token 是本函式剛從 LINE token 端點經 server-to-server TLS
  // 取得（可信來源），且 email 僅寫入 employees 供顯示、【不得用於任何授權判斷】。
  // 若未來要以 email 做身分/授權，務必改用 LINE verify 端點或 JWKS 驗簽後再採用。
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
    cors: CORS_ORIGINS,
    secrets: [LINE_CHANNEL_ID, LINE_CHANNEL_SECRET],
  },
  async (request) => {
    const code = request.data?.otoken || request.data?.code;

    if (!code) {
      return { ok: false, code: "ERR_MISSING_CODE" };
    }

    // M5：後端一次性驗證 OAuth state，杜絕 curl 直呼 getProfile 繞過純前端 state 檢查
    // （login CSRF / 授權碼注入）。state 由 getLoginUrl 產生並記錄。
    const stateCheck = await consumeOAuthState(request.data?.state);
    if (!stateCheck.valid) {
      return { ok: false, code: "ERR_INVALID_STATE" };
    }

    // B-L1：redirect_uri 以「getLoginUrl 當時記錄在 state 上的那個」為準，
    // 而不是這次請求帶來的值。兩者必須與送給 LINE 的完全一致才能換到 token；
    // 用 state 綁定的版本，前端就沒有任何空間在授權與交換之間換掉回跳網址。
    // （state 查不到 redirectUrl 的舊資料才退回請求值，仍過白名單。）
    const redirectUrl = safeRedirectUrl(
      stateCheck.redirectUrl || request.data?.redirectUrl || DEFAULT_LINE_REDIRECT_URL
    );

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
      // B-L5：不要把 LINE 原始錯誤回給前端。
      // exchangeCodeForToken 失敗時 err.message 內含 LINE 回應的完整 JSON
      // （error_description、有時帶 client_id 等設定線索），對攻擊者是免費的偵察資訊，
      // 對員工則是一串看不懂的英文。詳細只寫進 console.error 供維運查。
      console.error("getProfile 失敗:", err?.message || err);
      return { ok: false, code: "ERR_LINE_AUTH_FAILED" };
    }
  }
);
