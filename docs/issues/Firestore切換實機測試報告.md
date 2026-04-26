# Firestore 切換 — 實機測試報告

**測試日期**：2026-04-25
**環境**：分支 `claude/amazing-rubin-a2b7e2`、Chrome、`localhost:5173/?backend=firestore`
**後端**：Firebase Project `wenhui-check-in-system`，asia-southeast1 Cloud Functions + asia-east1 Firestore
**測試員**：林杰（管理員身份）
**資料規模**：23 員工 / 5758 打卡 / 16 地點

---

## 一、測試結論（總覽）

| 項目 | 狀態 | 備註 |
|------|------|------|
| LINE 登入 | ✅ 通過 | sessionToken 正確寫入 sessions collection |
| 主畫面（儀表板）| ✅ 通過 | 林杰 + 歡迎回來 + GPS 偵測成功 |
| Leaflet 地圖 | ✅ 通過 | 含打卡半徑 400m 紅圈 |
| 月份檢視 | ✅ 通過 | 4 月日曆完整、本月累計 41.54 小時 |
| 異常記錄 | ✅ 通過 | 7 筆異常正確識別（缺打卡、缺下班）|
| 員工列表 | ✅ 通過 | 23 人、含管理員身份識別 |
| 待審核請求 | ✅ 通過 | 1 筆補打卡待審 |
| 打卡地點 | ✅ 通過 | 16 個地點 |
| 時區（修復後）| ✅ 通過 | 打卡時間正確顯示為台灣時間（UTC+8）|

---

## 二、修復過的關鍵問題（依時序）

### 1. 🔴 Cloud Functions 部署沒裝依賴（已修）
**現象**：`firebase functions:list` 顯示 `No functions found`，前端 `cloudfunctions.net/checkSession → 404`

**根因**：之前在 `firebase-functions/` 跑 `npm install` 但 `package.json` 在 `firebase-functions/functions/`，npm 沒往下層找。

**修復**：`cd firebase-functions/functions && npm install`（241 packages）

### 2. 🔴 LINE_CHANNEL_ID secret 設錯（已修）
**現象**：`Confirm your request. Failed to convert ... 'java.lang.Integer' for ... "20079372007937895"`

**根因**：LINE Channel ID 應為 10 位數字，使用者貼上時複製到 17 位（疑似兩個值連在一起）。

**修復**：`firebase functions:secrets:set LINE_CHANNEL_ID` 重設為正確 10 位數字（version 變為 3）。

### 3. 🔴 Cloud Functions Blaze plan 必須升級
**現象**：第一次 deploy 報 `requires billing to be enabled`

**修復**：使用者升級 Firebase 專案至 Blaze plan，補建議設定 budget alert。

### 4. 🔴 Firestore database 沒建立 / 雙 database 衝突（已修）
**現象**：所有 Firestore 操作回 `5 NOT_FOUND`

**根因**：
- `firebase deploy --only firestore:rules` 第一次因 billing 失敗 → database 沒建
- 後來 deploy 自動建了 `(default)` 在 nam5（美國）
- 但專案中還有使用者昨天手動建的 `default` 在 asia-east1（台灣近）
- Cloud Functions admin SDK 預設指 `(default)` nam5，與本機 migration 寫入位置不一致

**修復**：
- `_helpers.js` 改用 `getFirestore(app, 'default')` 明確指定 asia-east1 database
- `migrate-to-firestore.js` 同樣
- 重 migrate（5758 筆寫到 asia-east1）
- 刪除 `(default)` nam5（避免日後混淆）

### 5. 🔴 `getProfile` 把 sToken 當 oneTimeToken，前端卻當 sessionToken 用（已修）
**現象**：登入後立即顯示「🔄 登入憑證-已失效「請重新登入」」

**根因**：原 GS 設計是「getProfile 寫 SHEET_SESSION 第 1 欄即 sessionToken」（一階段）。我的 Cloud Functions 拆成兩階段（getProfile 寫 oneTimeTokens、exchangeToken 才寫 sessions），但前端不知道，直接把 oneTimeToken 當 sessionToken 寫 localStorage → checkSession 找 sessions 找不到 → ERR_SESSION_INVALID。

**修復**：改 `_helpers.js` 的 `createOneTimeToken` 直接寫入 `sessions` collection 並回傳 sessionToken（與 GS 一階段流程對齊）。`exchangeToken` 保留但實際不使用。

### 6. 🔴 Migration 中文日期解析失敗（已修）
**現象**：dry-run 顯示 `timestamp: null`，5758 筆全壞

**根因**：Sheet 日期格式為「2026/4/25 上午 7:38:43」（中文 12 小時制），`new Date()` 不認識「上午/下午」。

**修復**：在 `scripts/migrate-to-firestore.js` 加 `parseChineseDateTime()` 解析中文 12 小時制。

### 7. 🟡 Cloud Functions 時區為 UTC，顯示時間少 8 小時（已修）
**現象**：打卡時間在前端顯示「23:38」應為「07:38」

**根因**：
- Firestore Timestamp 存的是絕對 UTC 時間（正確）
- Cloud Functions runtime 預設 UTC，`d.getHours()` 等回傳 UTC 時間
- 月份起訖也用本地時區，造成月份邊界錯亂 8 小時

**修復**：`_attendance.js` 加入 `TAIPEI_OFFSET_MS` + `toTaipei()` helper，所有日期/時間欄位用 `getUTC*` 從 Taipei-shifted Date 取得。`parseMonth()` 也改為以台灣時區月份對應的 UTC 範圍查詢。

### 8. 🟡 Google Sheets API 未啟用（已修）
**現象**：migration 報 `Google Sheets API has not been used in project 412072543991`

**修復**：使用者於 GCP Console 啟用 Sheets API（曾在錯的專案 `electric-clone-469205-f0` 啟用，後來在正確專案 `wenhui-check-in-system` 啟用後生效）。

### 9. 🟡 `index.html` 缺 `<meta charset="UTF-8">`（已修，commit `d141308`）
**現象**：dev 環境中文亂碼，連 JS 內中文字串也被誤解碼為 SyntaxError。

**修復**：head 第一個 tag 加 `<meta charset="UTF-8">`。

---

## 三、待辦項目修復記錄（2026-04-25 後續）

A、B、E、F 已修復；G 依使用者指示暫不處理。

| 待辦 | 修復 commit | 驗證結果 |
|------|------------|---------|
| A 補打卡 applicationTime 為空 | `d2bb8af` + 重 migrate attendance | `2026-04-24 23:55` 正確填入 |
| B 請假記錄重複顯示 | `d2bb8af`（_attendance.js summarizeByDay 加去重） | 4 月重複數從 N → 0 |
| C internal warning 殘留 | 已於 db routing 修復後消失 | – |
| D Cleanup policy | `firebase functions:artifacts:setpolicy` 設 1 天保留 | – |
| E zh-TW 缺翻譯鍵 | `d2bb8af`（5 語系補 BTN_CANCEL / BTN_CONFIRM） | 195 鍵（之前 192）|
| F firebase-functions SDK | `d2bb8af`（v6.0.1 → v7.2.5）+ 17 functions redeploy | 部署成功，無相容性問題 |
| G 勞基法異常規則 | **暫停** | 待重新設計薪資計算時一併處理 |
| H 管理員 LINE 通知 | `54336af`（getAdminList / sendLinePush / notifyAdmins helpers + submitLeave / adjustPunch 接入 + 新 testNotification） | 6/6 管理員收到測試訊息 ✓ |

---

## 四、原始待辦清單（保留作歷史）

### A. 🟡 `getReviewRequest` 的 `applicationTime` 為空字串
**現象**：
```json
{
  "id": "U982477d43d960d07ffb4d426b7fec3de_1777026660000_5752",
  "name": "Azzyz sudrajat",
  "type": "下班",
  "remark": "補打卡",
  "applicationTime": "",       // ← 空
  "targetTime": "2026-04-24 10:31"
}
```

**原因**：GS 版本的「申請時間」存放在 Sheet 的 GPS 欄位（格式 `申請時間: 2026-04-24 09:30`），需要 regex 解析。`migrate-to-firestore.js` 沒做這步轉換，只把整個 GPS 欄位字串當 `coords` 寫入 Firestore，缺乏獨立的 `applicationTime` 欄位。

**建議修法**：
1. `migrate-to-firestore.js` 增加：當 row 的 GPS 欄位以「申請時間:」開頭時，解析出時間並寫入 `applicationTime` Timestamp 欄位
2. 跑 `npm run migrate -- --clear --only=attendance` 重灌打卡資料
3. 或保持現狀，於前端顯示時 fallback 用 `targetTime`

### B. 🟡 同一天請假記錄重複出現 2 次
**現象**：
```json
{
  "date": "2026-04-02",
  "reason": "STATUS_LEAVE_APPROVED",
  "records": [
    { "time": "08:00", "type": "請假", "location": "病假" },
    { "time": "08:00", "type": "請假", "location": "病假" }   // ← 重複
  ]
}
```

**可能原因**：
1. 來源 Sheet 本身有重複資料（員工誤申請了兩次）
2. 或 migration 把同一筆 Sheet row 寫了兩次（因為 doc id 含 `_idx` 不同所以兩筆都進去）

**建議查證**：
```bash
# 在 Firebase Console 查 attendance collection
# 過濾 userId + 2026-04-02 看是否真有 2 筆
```
若是來源資料重複，前端可在 `summarizeByDay` 內做去重（同 type + 同 time 視為一筆）。

### C. 🟡 Cloud Function `internal` warning 殘留
**Cloud Functions logs 早期出現** `getprofile: 5 NOT_FOUND`，後因 database 修復已不再出現。但歷史 log 仍可見，新使用者部署時不會有此問題。

### D. 🟡 Cleanup policy 警告
部署完成後 CLI 警告：
```
No cleanup policy detected for repositories in asia-southeast1.
```
**已修**：跑了 `firebase functions:artifacts:setpolicy --location=asia-southeast1` 設 1 天保留。

### E. 🟢 zh-TW 缺 2 個翻譯鍵
`i18n/zh-TW.json` 缺 2 鍵（具體未列）。不影響功能。

### F. 🟢 firebase-functions SDK 版本提示
部署時警告：
```
package.json indicates an outdated version of firebase-functions.
Please upgrade using npm install --save firebase-functions@latest
```
與 Node.js 20 將於 2026-04-30 deprecated 同步處理（升級到 v6+ 與 Node 22）。

### G. 🟡 待對齊勞基法異常規則
`_attendance.js` 的 `summarizeByDay` 與 `detectAbnormal` 為簡化版（只判斷上班/下班缺失與請假狀態），未對齊 GS `Utils.gs` 的完整勞基法規則（遲到、早退、加班分段等）。

---

## 四、效能初步觀察

從 migration 重跑時觀察到的耗時：
- 5758 筆 attendance 寫入：**約 30-40 秒**（每 400 筆一批）
- Cloud Functions cold start：第一次呼叫約 **2-3 秒**，warm 後約 **300-500ms**
- LINE OAuth 完整流程（從點按鈕到看到儀表板）：**約 3-5 秒**

未做正式 benchmark，但從體感**比 GAS 快 2-3 倍**（GAS 之前打卡耗時約 5-8 秒）。

---

## 五、環境設定備忘

| 項目 | 值 |
|------|---|
| Firebase Project ID | `wenhui-check-in-system` |
| Project Number | `412072543991` |
| Cloud Functions Region | `asia-southeast1` |
| Firestore Database | `default`（asia-east1 / ENTERPRISE）|
| Firestore Rules | 全鎖（前端直存拒絕，僅 Cloud Functions 用 Admin SDK 操作）|
| Plan | Blaze（按用量計費，預估 $0/月）|
| Cleanup Policy | 容器映像保留 1 天 |
| Secrets | LINE_CHANNEL_ID v3、LINE_CHANNEL_SECRET v1、LINE_CHANNEL_ACCESS_TOKEN v1 |
| Service Account | `412072543991-compute@developer.gserviceaccount.com` |
| Migration Service Account | `firebase-adminsdk-fbsvc@wenhui-check-in-system.iam.gserviceaccount.com` |

---

## 六、下一步建議

依優先級：

| 優先 | 項目 | 預估 |
|------|------|------|
| P1 | 修 A（補打卡 applicationTime）+ 重 migrate attendance | 30 分 |
| P1 | 查 B（請假重複）並決定處理方式 | 20 分 |
| P2 | 對齊 G（勞基法異常規則）| 2-4 小時 |
| P2 | 完整功能流程驗證：實際走打卡 → 補打卡 → 審核 | 30 分 |
| P3 | 升級 firebase-functions SDK + Node 22 runtime | 1 小時 |
| P3 | 異步通知佇列接入（管理員 LINE 通知） | 2-3 小時 |

---

## 七、結論

**Firestore 後端整合在分支環境已可運作**：
- 17 個 Cloud Functions 全部部署成功
- 完整 LINE 登入流程通過
- 月曆、異常、員工、請假審核資料皆能正確讀取
- 時區問題已修復
- 主線（GAS）完全不受影響

**建議的「轉正」路徑**（階段 E 決策）：
1. 先修 A、B 兩個 P1 問題
2. 完整跑一輪打卡 → 補打卡 → 審核流程驗證
3. 觀察 1-2 週使用體驗（仍以 GAS 為主，分支供測試）
4. 確認穩定後考慮把 Firestore 主邏輯合回 main 分支，main 加 feature flag 預設關閉，逐步放量
