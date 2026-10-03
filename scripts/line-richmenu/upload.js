/**
 * 建立 LINE 圖文選單（上班 / 下班 / 打卡紀錄 / 審核），並設成所有好友的預設選單。
 *
 * 用法（在 repo 根目錄）：
 *   LINE_TOKEN="$(cd firebase-functions && firebase functions:secrets:access LINE_CHANNEL_ACCESS_TOKEN)" node scripts/line-richmenu/upload.js
 *
 * 改圖：編輯 menu.html，再重產 menu.png：
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=2500,1686 --screenshot=scripts/line-richmenu/menu.png scripts/line-richmenu/menu.html
 *
 * 重跑會再建一個新選單並換成預設；舊選單留在 LINE 上不影響使用。
 * ponytail: 不自動刪舊選單，LINE 上限 1000 個，真的累積很多再清。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.LINE_TOKEN;
if (!TOKEN) {
  console.error("缺 LINE_TOKEN，用法見檔案開頭");
  process.exit(1);
}

const SITE = "https://wenhuistage-ops.github.io/";
const W = 1250;
const H = 843;
const area = (x, y, uri) => ({ bounds: { x, y, width: W, height: H }, action: { type: "uri", uri } });

const menu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "考勤選單",
  chatBarText: "Menu",
  areas: [
    area(0, 0, `${SITE}?action=in`), // 上班：auto-punch.js 會跳確認框再打卡
    area(W, 0, `${SITE}?action=out`), // 下班
    area(0, H, `${SITE}#monthly-view`), // 打卡紀錄（月曆）
    area(W, H, `${SITE}#review`), // 審核：管理員開表單審核、員工開我的申請（app.js）
  ],
};

async function post(url, body, contentType = "application/json") {
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${url} → ${resp.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  const { richMenuId } = await post("https://api.line.me/v2/bot/richmenu", JSON.stringify(menu));
  await post(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    fs.readFileSync(path.join(__dirname, "menu.png")),
    "image/png"
  );
  await post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`);
  console.log("✓ 圖文選單已上線，richMenuId =", richMenuId);
})().catch((err) => {
  console.error("✗ 失敗：", err.message);
  process.exit(1);
});
