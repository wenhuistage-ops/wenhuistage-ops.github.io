/**
 * lineWebhook — LINE Messaging API webhook：管理員在補打卡卡片上按「核准 / 退回」
 *
 * 卡片由 adjustPunch / updateAdjustRequest 發出（_review.js buildAdjustReviewCard），
 * 按鈕是 postback：data = "review=approve|reject&id=<attendance docId>&ts=<補卡時間毫秒>"
 *
 * 安全：
 *   1. x-line-signature 用 Messaging API channel secret 驗 HMAC，不是 LINE 送的一律 401
 *   2. 按的人（event.source.userId）每次即時讀 employees 確認是「啟用中的管理員」，
 *      不吃 getAdminList 快取 → 降權立即生效
 *   3. 審核本身走 reviewRequest（與網頁同一套狀態機：只審 '?'、不得自審、ts 對不上就擋）
 *
 * 設定（一次性）：LINE Developers → Messaging API channel
 *   - Webhook URL：https://asia-southeast1-wenhui-check-in-system.cloudfunctions.net/lineWebhook
 *   - Use webhook：開
 */

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const {
  db,
  COLLECTIONS,
  isValidDocId,
  formatTaipei,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_MESSAGING_CHANNEL_SECRET,
} = require("./_helpers");
const { reviewRequest } = require("./_review");

/** LINE 簽章 = base64(HMAC-SHA256(channelSecret, rawBody)) */
function isValidLineSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(String(signature), "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const ERR_REPLY = {
  ERR_ALREADY_REVIEWED: "這筆申請已經審核過了（可能是其他管理員先按了）。",
  ERR_NOT_FOUND: "找不到這筆申請，可能已被員工刪除。",
  ERR_REQUEST_CHANGED: "員工已修改這筆申請，請看最新的那張卡片。",
  ERR_CANNOT_SELF_APPROVE: "不能審核自己的申請，請另一位管理員處理。",
  ERR_NOT_REVIEWABLE: "這筆紀錄不需要審核。",
  ERR_NO_PERMISSION: "只有管理員可以審核。",
};

/** 處理一個 postback，回傳要回覆給按的人的文字（null = 不是審核按鈕，不回） */
async function handleReviewPostback(event, accessToken) {
  const p = new URLSearchParams(event.postback?.data || "");
  const decision = p.get("review");
  if (decision !== "approve" && decision !== "reject") return null;

  const id = p.get("id") || "";
  const ts = Number(p.get("ts"));
  const uid = event.source?.userId || "";
  if (!isValidDocId(id) || !Number.isFinite(ts)) return ERR_REPLY.ERR_NOT_FOUND;
  if (!isValidDocId(uid)) return ERR_REPLY.ERR_NO_PERMISSION;

  const emp = (await db.collection(COLLECTIONS.EMPLOYEES).doc(uid).get()).data();
  if (!emp || emp.dept !== "管理員" || (emp.status || "啟用") !== "啟用") {
    return ERR_REPLY.ERR_NO_PERMISSION;
  }

  const res = await reviewRequest({ id, decision, reviewerId: uid, expectedTsMillis: ts, accessToken });
  if (!res.ok) return ERR_REPLY[res.code] || "審核失敗，請到系統上操作。";
  const d = res.data;
  return (
    `${decision === "approve" ? "✅ 已核准" : "❌ 已退回"}：` +
    `${d.name || "員工"} 的補打卡（${formatTaipei(res.punchDate)} ${d.type || ""}）`
  );
}

async function replyText(replyToken, text, accessToken) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!resp.ok) console.warn(`LINE reply 失敗: ${resp.status} ${await resp.text()}`);
}

module.exports = onRequest(
  {
    region: "asia-southeast1",
    secrets: [LINE_CHANNEL_ACCESS_TOKEN, LINE_MESSAGING_CHANNEL_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }
    if (!isValidLineSignature(req.rawBody, req.get("x-line-signature"), LINE_MESSAGING_CHANNEL_SECRET.value())) {
      res.status(401).end();
      return;
    }

    const accessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
    for (const event of req.body?.events || []) {
      if (event.type !== "postback") continue;
      try {
        const text = await handleReviewPostback(event, accessToken);
        if (text && event.replyToken) await replyText(event.replyToken, text, accessToken);
      } catch (err) {
        console.error("lineWebhook 處理 postback 失敗:", err?.message);
      }
    }
    // 處理完才回 200（gen2 回應後 CPU 會被降速）；個別事件失敗也回 200，免得 LINE 重送
    res.status(200).end();
  }
);
